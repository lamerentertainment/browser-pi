// Browser-sichere streamFn für pi-agent-core.
//
// pi-agent-core ruft normalerweise pi-ai's `streamSimple` auf, das einen
// Provider aus der Registry auflöst (inkl. Node-only-SDKs wie Bedrock). Statt
// dessen injizieren wir hier eine eigene streamFn: Sie spricht DIREKT den
// lokalen, OpenAI-kompatiblen Endpoint (Ollama/OpenWebUI) per fetch an und
// erfüllt das AssistantMessageEventStream-Protokoll. So gelangt kein
// kommerzieller Provider und kein Node-Builtin in den Browser-Bundle
// (CLAUDE.md, Prinzip 1).
//
// Der Endpoint wird mit `stream: true` (Server-Sent Events) angesprochen, damit
// Text UND Reasoning des Modells TOKEN-FÜR-TOKEN durchgereicht werden. Reasoning
// erkennen wir auf zwei Wegen, weil lokale Endpoints es unterschiedlich liefern:
//   1. explizite Delta-Felder `reasoning_content` (Ollama/DeepSeek) bzw.
//      `reasoning` (manche OpenWebUI-/OpenRouter-kompatible Server), oder
//   2. inline `<think>…</think>`-Tags im normalen `content` (verbreitet bei
//      R1-/qwen-Modellen, die über OpenAI-kompatible Server laufen).
// Beides routen wir in einen separaten "thinking"-Block, sodass die Antwort
// sauber vom Reasoning getrennt bleibt.

import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Context,
	type Model,
	type StreamOptions,
	type Usage,
} from "@earendil-works/pi-ai";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

type Content = AssistantMessage["content"];
type ThinkingBlock = { type: "thinking"; thinking: string };
type TextBlock = { type: "text"; text: string };

// --- Konvertierung pi-Context -> OpenAI-Chat-Completions-Payload ---------

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}
interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
			.map((c) => c.text)
			.join("");
	}
	return "";
}

function toOpenAIMessages(context: Context): OpenAIMessage[] {
	const out: OpenAIMessage[] = [];
	if (context.systemPrompt) out.push({ role: "system", content: context.systemPrompt });
	for (const m of context.messages) {
		if (m.role === "user") {
			out.push({ role: "user", content: textOf(m.content) });
		} else if (m.role === "assistant") {
			const text = textOf(m.content);
			const toolCalls = m.content
				.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall")
				.map((tc) => ({
					id: tc.id,
					type: "function" as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
				}));
			out.push({
				role: "assistant",
				content: text || null,
				...(toolCalls.length ? { tool_calls: toolCalls } : {}),
			});
		} else if (m.role === "toolResult") {
			out.push({ role: "tool", tool_call_id: m.toolCallId, content: textOf(m.content) });
		}
	}
	return out;
}

// --- streamFn ------------------------------------------------------------

interface StreamDelta {
	content?: string | null;
	reasoning_content?: string | null;
	reasoning?: string | null;
	tool_calls?: Array<{
		index?: number;
		id?: string;
		function?: { name?: string; arguments?: string };
	}>;
}

export function createBrowserStreamFn(getApiKey: () => string) {
	return (model: Model<"openai-completions">, context: Context, options?: StreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const signal = options?.signal;
		const apiKey = options?.apiKey || getApiKey();

		const base = {
			role: "assistant" as const,
			api: "openai-completions" as const,
			provider: model.provider,
			model: model.id,
			usage: EMPTY_USAGE,
			timestamp: Date.now(),
		};

		void (async () => {
			// Laufender Zustand der Streaming-Antwort.
			const content: Content = [];
			let thinkingIndex: number | null = null;
			let textIndex: number | null = null;
			const toolAcc = new Map<number, { id: string; name: string; args: string }>();
			let finishReason: string | null = null;

			// `<think>`-Tag-Parser über content-Chunks hinweg.
			let inThink = false;
			let pending = "";

			const snap = (): AssistantMessage => ({ ...base, content: [...content], stopReason: "stop" });

			const closeThinking = () => {
				if (thinkingIndex === null) return;
				const block = content[thinkingIndex] as ThinkingBlock;
				stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block.thinking, partial: snap() });
				thinkingIndex = null;
			};
			const closeText = () => {
				if (textIndex === null) return;
				const block = content[textIndex] as TextBlock;
				stream.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: snap() });
				textIndex = null;
			};

			const emitReasoning = (delta: string) => {
				if (!delta) return;
				closeText();
				if (thinkingIndex === null) {
					thinkingIndex = content.length;
					content.push({ type: "thinking", thinking: "" });
					stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: snap() });
				}
				(content[thinkingIndex] as ThinkingBlock).thinking += delta;
				stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta, partial: snap() });
			};
			const emitText = (delta: string) => {
				if (!delta) return;
				closeThinking();
				if (textIndex === null) {
					textIndex = content.length;
					content.push({ type: "text", text: "" });
					stream.push({ type: "text_start", contentIndex: textIndex, partial: snap() });
				}
				(content[textIndex] as TextBlock).text += delta;
				stream.push({ type: "text_delta", contentIndex: textIndex, delta, partial: snap() });
			};

			// Verarbeitet rohen content-Text und trennt `<think>`-Abschnitte heraus.
			// `flush=true` am Stream-Ende gibt auch eventuell zurückgehaltene
			// Tag-Präfixe frei.
			const processContent = (chunk: string, flush: boolean) => {
				pending += chunk;
				for (;;) {
					if (inThink) {
						const close = pending.indexOf(THINK_CLOSE);
						if (close !== -1) {
							emitReasoning(pending.slice(0, close));
							pending = pending.slice(close + THINK_CLOSE.length);
							inThink = false;
							continue;
						}
						const safe = flush ? pending.length : holdBack(pending, THINK_CLOSE);
						emitReasoning(pending.slice(0, safe));
						pending = pending.slice(safe);
						break;
					}
					const open = pending.indexOf(THINK_OPEN);
					if (open !== -1) {
						emitText(pending.slice(0, open));
						pending = pending.slice(open + THINK_OPEN.length);
						inThink = true;
						continue;
					}
					const safe = flush ? pending.length : holdBack(pending, THINK_OPEN);
					emitText(pending.slice(0, safe));
					pending = pending.slice(safe);
					break;
				}
			};

			try {
				const url = `${model.baseUrl.replace(/\/$/, "")}/chat/completions`;
				const res = await fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
					},
					body: JSON.stringify({
						model: model.id,
						messages: toOpenAIMessages(context),
						tools: context.tools?.map((t) => ({
							type: "function",
							function: { name: t.name, description: t.description, parameters: t.parameters },
						})),
						tool_choice: "auto",
						stream: true,
						// OpenWebUIs OpenAI-Kompat-Endpoint braucht chat_id, sonst 400
						// ('NoneType'.startswith). Leerstring genügt. Bewährt in
						// iusable_anonymization gegen denselben OpenWebUI-Server.
						chat_id: "",
					}),
					signal,
				});

				if (!res.ok) {
					const body = await res.text().catch(() => "");
					throw new Error(`LLM-Endpoint ${res.status}: ${body || res.statusText}`);
				}
				if (!res.body) throw new Error("LLM-Endpoint lieferte keinen Stream-Body (stream: true).");

				stream.push({ type: "start", partial: snap() });

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				reading: for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const raw of lines) {
						const line = raw.trim();
						if (!line || !line.startsWith("data:")) continue;
						const data = line.slice(5).trim();
						if (data === "[DONE]") break reading;
						let json: {
							choices?: Array<{ delta?: StreamDelta; finish_reason?: string | null }>;
						};
						try {
							json = JSON.parse(data);
						} catch {
							continue;
						}
						const choice = json.choices?.[0];
						if (!choice) continue;
						if (choice.finish_reason) finishReason = choice.finish_reason;
						const delta = choice.delta ?? {};

						const reasoning = delta.reasoning_content ?? delta.reasoning;
						if (typeof reasoning === "string") emitReasoning(reasoning);

						if (typeof delta.content === "string") processContent(delta.content, false);

						for (const tc of delta.tool_calls ?? []) {
							const idx = tc.index ?? 0;
							let entry = toolAcc.get(idx);
							if (!entry) {
								entry = { id: tc.id ?? "", name: "", args: "" };
								toolAcc.set(idx, entry);
							}
							if (tc.id) entry.id = tc.id;
							if (tc.function?.name) entry.name += tc.function.name;
							if (tc.function?.arguments) entry.args += tc.function.arguments;
						}
					}
				}

				// Restpuffer freigeben und offene Blöcke schliessen.
				processContent("", true);
				closeThinking();
				closeText();

				// Tool-Calls finalisieren (in content-Reihenfolge: Index-sortiert).
				for (const [idx, entry] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
					const contentIndex = content.length;
					const toolCall = {
						type: "toolCall" as const,
						id: entry.id || `call_${idx}`,
						name: entry.name,
						arguments: safeJson(entry.args),
					};
					content.push(toolCall);
					stream.push({ type: "toolcall_start", contentIndex, partial: snap() });
					stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: snap() });
				}

				const hasToolUse = toolAcc.size > 0;
				const reason = hasToolUse ? "toolUse" : finishReason === "length" ? "length" : "stop";
				const finalMessage: AssistantMessage = { ...base, content: [...content], stopReason: reason };
				stream.push({ type: "done", reason, message: finalMessage });
			} catch (err) {
				const aborted = signal?.aborted || (err as Error)?.name === "AbortError";
				const errorMessage: AssistantMessage = {
					...base,
					content: [...content],
					stopReason: aborted ? "aborted" : "error",
					errorMessage: (err as Error).message,
				};
				stream.push({
					type: "error",
					reason: aborted ? "aborted" : "error",
					error: errorMessage,
				});
			}
		})();

		return stream;
	};
}

/**
 * Längster Präfix von `str`, der sicher emittiert werden kann, ohne ein über
 * die Chunk-Grenze gesplittetes `tag` zu zerschneiden. Hält das längste
 * Suffix zurück, das ein echtes Präfix von `tag` ist.
 */
function holdBack(str: string, tag: string): number {
	const max = Math.min(str.length, tag.length - 1);
	for (let k = max; k > 0; k--) {
		if (str.slice(str.length - k) === tag.slice(0, k)) return str.length - k;
	}
	return str.length;
}

function safeJson(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw || "{}");
		return v && typeof v === "object" ? v : {};
	} catch {
		return {};
	}
}
