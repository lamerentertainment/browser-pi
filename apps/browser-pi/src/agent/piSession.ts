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

const SYSTEM_PROMPT = `Du bist pi, ein Agent, der vollständig im Browser läuft und in einem
sandboxierten Dokumenten-Dateisystem arbeitet (Verzeichnisse: /cases, /prompts,
/textblocks). Du hast KEINEN Zugriff auf das Host-System, das Internet oder
beliebige Shell-Befehle — nur auf die bereitgestellten Tools.

Arbeitsweise:
- Nutze die Tools, um Dateien zu lesen, zu durchsuchen und zu schreiben.
- Bevorzuge gezielte Tool-Aufrufe statt Vermutungen über Dateiinhalte.
- Wenn die Aufgabe erledigt ist, antworte knapp auf Deutsch ohne weiteren Tool-Call.

Sensible Inhalte verlassen den Browser nie.`;

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

export class PiAgentSession {
	private agent: Agent;
	private ctx: ShellContext = { cwd: "/" };
	private config: LlmConfig;

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
			await this.agent.prompt(userText);
			return { cancelled: false };
		} catch (e) {
			this.emit({ type: "error", text: (e as Error).message });
			return { cancelled: false };
		}
	}

	// --- Mapping pi-AgentEvent -> UI-Event (events.ts) ---------------------
	private onPiEvent(event: PiAgentEvent): void {
		switch (event.type) {
			case "message_end": {
				const m = event.message;
				if (m.role === "assistant") {
					const text = assistantText(m);
					if (text) this.emit({ type: "assistant", text });
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
