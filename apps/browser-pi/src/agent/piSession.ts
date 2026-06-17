// PiAgentSession — die Agenten-Schleife auf Basis des ECHTEN pi-agent-core.
//
// Ersetzt die frühere, selbstgebaute Schleife (agentLoop.ts). Die UI
// (Terminal/Events) und die Sandbox (VFS/Shell) bleiben unverändert: diese
// Session bietet dieselbe Schnittstelle (send/cancel/updateConfig) und mappt
// die nativen pi-AgentEvents auf die UI-Events aus events.ts.

import { Agent, type AgentEvent as PiAgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, Provider } from "@earendil-works/pi-ai";
import type { ShellContext } from "../shell/shell.ts";
import type { EventSink } from "./events.ts";
import { createBrowserStreamFn } from "./piStream.ts";
import { createPiTools } from "./piTools.ts";
import type { LlmConfig } from "./llm.ts";
import { vfs } from "../vfs/vfs.ts";

const SYSTEM_PROMPT = `Du bist pi, ein Agent, der vollständig im Browser läuft und in einem
sandboxierten Dokumenten-Dateisystem arbeitet (Verzeichnisse: /cases, /prompts,
/textblocks). Du hast KEINEN Zugriff auf das Host-System, das Internet oder
beliebige Shell-Befehle — nur auf die bereitgestellten Tools.

Arbeitsweise:
- Nutze die Tools, um Dateien zu lesen, zu durchsuchen und zu schreiben.
- Bevorzuge gezielte Tool-Aufrufe statt Vermutungen über Dateiinhalte.
- Wenn die Aufgabe erledigt ist, antworte knapp auf Deutsch ohne weiteren Tool-Call.

Sensible Inhalte verlassen den Browser nie.`;

async function buildSystemPrompt(): Promise<string> {
	try {
		const files = await vfs.list("/prompts");
		const promptLines: string[] = [];
		for (const file of files) {
			if (file.type === "file") {
				try {
					const content = await vfs.readFile(file.path);
					// Extract the title (H1) or use the filename.
					const m = content.match(/^#\s+(.+?)\s*$/m);
					const title = m?.[1]?.trim() || file.name.replace(/\.md$/i, "");
					promptLines.push(`- Title: "${title}" (Path: "${file.path}")`);
				} catch (e) {
					promptLines.push(`- Path: "${file.path}"`);
				}
			}
		}

		let promptSection = "";
		if (promptLines.length > 0) {
			promptSection = `\n\nVerfügbare Prompt-Vorlagen im System:\n${promptLines.join("\n")}\nWenn eine dieser Vorlagen für die Aufgabe nützlich ist, kannst du sie mit dem read/grep Tool lesen, um ihre Anweisungen präzise zu berücksichtigen und anzuwenden.`;
		}

		return SYSTEM_PROMPT + promptSection;
	} catch (err) {
		return SYSTEM_PROMPT;
	}
}

/** Baut ein OpenAI-kompatibles Model-Objekt aus der Nutzerkonfiguration. */
function buildModel(config: LlmConfig): Model<"openai-completions"> {
	return {
		id: config.model,
		name: config.model,
		api: "openai-completions",
		provider: "ollama" as Provider,
		baseUrl: config.baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 4096,
	};
}

function assistantText(msg: AssistantMessage): string {
	return msg.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

/** Schmale Sicht auf die pi-ai-Stream-Chunks, die wir in UI-Events übersetzen. */
type StreamChunk =
	| { type: "thinking_delta"; delta: string }
	| { type: "text_delta"; delta: string }
	| { type: "thinking_end" }
	| { type: "text_end" }
	| { type: string };

export class PiAgentSession {
	private agent: Agent;
	private ctx: ShellContext = { cwd: "/" };
	private config: LlmConfig;

	// Streaming-Zustand der laufenden Assistant-Nachricht.
	private reasoningBuf = "";
	private textBuf = "";
	private reasoningOpen = false; // reasoning wird gerade gestreamt (noch nicht eingefroren)
	private textOpen = false; // antwort-text wird gerade gestreamt

	constructor(config: LlmConfig, private emit: EventSink) {
		this.config = config;
		this.agent = new Agent({
			initialState: {
				systemPrompt: SYSTEM_PROMPT,
				model: buildModel(config),
				tools: createPiTools(this.ctx),
			},
			// Eigene, browser-sichere streamFn statt pi-ai's Provider-Registry.
			streamFn: createBrowserStreamFn(() => this.config.apiKey),
			// Tools teilen sich ein cwd -> sequentielle Ausführung.
			toolExecution: "sequential",
		});

		this.agent.subscribe((event) => this.onPiEvent(event));
	}

	updateConfig(config: LlmConfig): void {
		this.config = config;
		// Modell/Endpoint für den nächsten Lauf aktualisieren.
		this.agent.state.model = buildModel(config);
	}

	get cwd(): string {
		return this.ctx.cwd;
	}

	cancel(): void {
		this.agent.abort();
	}

	async send(userText: string): Promise<{ cancelled: boolean }> {
		this.emit({ type: "user", text: userText });
		try {
			this.agent.state.systemPrompt = await buildSystemPrompt();
			await this.agent.prompt(userText);
			return { cancelled: false };
		} catch (e) {
			this.emit({ type: "error", text: (e as Error).message });
			return { cancelled: false };
		}
	}

	// Token-für-Token-Chunks aus message_update -> Streaming-UI-Events.
	private onStreamChunk(chunk: StreamChunk): void {
		switch (chunk.type) {
			case "thinking_delta":
				this.reasoningBuf += (chunk as { delta: string }).delta;
				this.reasoningOpen = true;
				this.emit({ type: "reasoning", text: this.reasoningBuf, streaming: true });
				break;
			case "thinking_end":
				if (this.reasoningOpen) {
					this.emit({ type: "reasoning", text: this.reasoningBuf, streaming: false });
					this.reasoningOpen = false;
				}
				break;
			case "text_delta":
				this.textBuf += (chunk as { delta: string }).delta;
				this.textOpen = true;
				this.emit({ type: "assistant", text: this.textBuf, streaming: true });
				break;
			case "text_end":
				if (this.textOpen) {
					this.emit({ type: "assistant", text: this.textBuf, streaming: false });
					this.textOpen = false;
				}
				break;
		}
	}

	// --- Mapping pi-AgentEvent -> UI-Event (events.ts) ---------------------
	private onPiEvent(event: PiAgentEvent): void {
		switch (event.type) {
			case "message_start":
				// Neue Assistant-Nachricht: Streaming-Zustand zurücksetzen.
				this.reasoningBuf = "";
				this.textBuf = "";
				this.reasoningOpen = false;
				this.textOpen = false;
				break;

			case "message_update":
				this.onStreamChunk(event.assistantMessageEvent as StreamChunk);
				break;

			case "message_end": {
				const m = event.message;
				if (m.role === "assistant") {
					// Offene Streams einfrieren (falls *_end-Chunk ausblieb).
					if (this.reasoningOpen) {
						this.emit({ type: "reasoning", text: this.reasoningBuf, streaming: false });
						this.reasoningOpen = false;
					}
					const text = assistantText(m);
					if (this.textOpen) {
						this.emit({ type: "assistant", text: text || this.textBuf, streaming: false });
						this.textOpen = false;
					} else if (!this.textBuf && text) {
						// Kein Live-Streaming (z.B. nicht-streamender Fallback) -> einmalig.
						this.emit({ type: "assistant", text });
					}
					if (m.stopReason === "error" && m.errorMessage) {
						this.emit({ type: "error", text: m.errorMessage });
					}
				}
				break;
			}
			case "tool_execution_start":
				this.emit({
					type: "tool_call",
					id: event.toolCallId,
					name: event.toolName,
					args: (event.args ?? {}) as Record<string, unknown>,
				});
				break;
			case "tool_execution_end": {
				const out = extractToolText(event.result);
				this.emit({
					type: "tool_result",
					id: event.toolCallId,
					name: event.toolName,
					output: out,
					exitCode: event.isError ? 1 : 0,
				});
				break;
			}
		}
	}
}

function extractToolText(result: unknown): string {
	const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
	if (Array.isArray(content)) {
		const t = content
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text)
			.join("");
		if (t) return t;
	}
	return "(keine Ausgabe)";
}
