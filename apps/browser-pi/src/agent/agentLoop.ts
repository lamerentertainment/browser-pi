// Agenten-Schleife: läuft vollständig im Browser, kein Server-Roundtrip.
// Sie ruft das lokale LLM auf, führt Tool-Calls gegen die VFS-Sandbox aus und
// speist die Ergebnisse zurück, bis das Modell ohne Tool-Call antwortet.
//
// Diese Schleife ist bewusst eigenständig (kein Fork von pi-agent-core). Sie
// modelliert dasselbe Muster (Tool-Calling-Loop, Event-Stream) und kann später
// gegen pi-agent-core ausgetauscht werden, ohne UI/Sandbox anzufassen.

import type { AgentEvent, EventSink } from "./events.ts";
import { chatCompletion, type ChatMessage, type LlmConfig } from "./llm.ts";
import { getTool, TOOL_SPECS } from "./tools.ts";
import type { ShellContext } from "../shell/shell.ts";

const MAX_STEPS = 12;

const SYSTEM_PROMPT = `Du bist pi, ein Agent, der vollständig im Browser läuft und in einem
sandboxierten Dokumenten-Dateisystem arbeitet (Verzeichnisse: /cases, /prompts,
/textblocks). Du hast KEINEN Zugriff auf das Host-System, das Internet oder
beliebige Shell-Befehle — nur auf die bereitgestellten Tools.

Arbeitsweise:
- Nutze die Tools, um Dateien zu lesen, zu durchsuchen und zu schreiben.
- Bevorzuge gezielte Tool-Aufrufe statt Vermutungen über Dateiinhalte.
- Wenn die Aufgabe erledigt ist, antworte knapp auf Deutsch ohne weiteren Tool-Call.

Sensible Inhalte verlassen den Browser nie.`;

export interface RunResult {
	cancelled: boolean;
}

export class AgentSession {
	private messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
	private ctx: ShellContext = { cwd: "/" };
	private abort: AbortController | null = null;

	constructor(
		private config: LlmConfig,
		private emit: EventSink,
	) {}

	updateConfig(config: LlmConfig): void {
		this.config = config;
	}

	cancel(): void {
		this.abort?.abort();
	}

	get cwd(): string {
		return this.ctx.cwd;
	}

	async send(userText: string): Promise<RunResult> {
		this.emit({ type: "user", text: userText });
		this.messages.push({ role: "user", content: userText });
		this.abort = new AbortController();
		const signal = this.abort.signal;

		try {
			for (let step = 0; step < MAX_STEPS; step++) {
				if (signal.aborted) return { cancelled: true };
				this.emit({ type: "status", text: `Denkt nach (${this.config.model})…` });

				const res = await chatCompletion(this.config, this.messages, TOOL_SPECS, signal);

				// Assistenten-Turn protokollieren (mit etwaigen Tool-Calls).
				this.messages.push({
					role: "assistant",
					content: res.content,
					tool_calls: res.toolCalls.length ? res.toolCalls : undefined,
				});

				if (res.content) {
					this.emit({ type: "assistant", text: res.content });
				}

				if (res.toolCalls.length === 0) {
					return { cancelled: false };
				}

				// Tool-Calls sequentiell gegen die Sandbox ausführen.
				for (const call of res.toolCalls) {
					if (signal.aborted) return { cancelled: true };
					const args = safeParseArgs(call.function.arguments);
					this.emit({
						type: "tool_call",
						id: call.id,
						name: call.function.name,
						args,
					});

					const tool = getTool(call.function.name);
					let output: string;
					let exitCode: number;
					if (!tool) {
						output = `Unbekanntes Tool: ${call.function.name}`;
						exitCode = 1;
					} else {
						const r = await tool.run(args, { ctx: this.ctx });
						output = r.output;
						exitCode = r.exitCode;
					}

					this.emit({
						type: "tool_result",
						id: call.id,
						name: call.function.name,
						output,
						exitCode,
					});

					this.messages.push({
						role: "tool",
						tool_call_id: call.id,
						name: call.function.name,
						content: truncate(output, 8000),
					});
				}
			}
			this.emit({ type: "error", text: `Maximale Schrittzahl (${MAX_STEPS}) erreicht.` });
			return { cancelled: false };
		} catch (e) {
			if (signal.aborted) return { cancelled: true };
			this.emit({ type: "error", text: (e as Error).message });
			return { cancelled: false };
		} finally {
			this.abort = null;
		}
	}
}

function safeParseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw || "{}");
		return typeof parsed === "object" && parsed ? parsed : {};
	} catch {
		return {};
	}
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}\n…(gekürzt)`;
}

export type { AgentEvent };
