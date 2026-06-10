// Browser-sichere streamFn für pi-agent-core.
//
// pi-agent-core ruft normalerweise pi-ai's `streamSimple` auf, das einen
// Provider aus der Registry auflöst (inkl. Node-only-SDKs wie Bedrock). Statt
// dessen injizieren wir hier eine eigene streamFn: Sie spricht DIREKT den
// lokalen, OpenAI-kompatiblen Endpoint (Ollama/OpenWebUI) per fetch an und
// erfüllt das AssistantMessageEventStream-Protokoll. So gelangt kein
// kommerzieller Provider und kein Node-Builtin in den Browser-Bundle
// (CLAUDE.md, Prinzip 1).

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

export function createBrowserStreamFn(getApiKey: () => string) {
	return (model: Model<"openai-completions">, context: Context, options?: StreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const signal = options?.signal;
		const apiKey = options?.apiKey || getApiKey();

		void (async () => {
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
						stream: false,
					}),
					signal,
				});

				if (!res.ok) {
					const body = await res.text().catch(() => "");
					throw new Error(`LLM-Endpoint ${res.status}: ${body || res.statusText}`);
				}

				const json = (await res.json()) as {
					choices?: Array<{
						message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
					}>;
				};
				const msg = json.choices?.[0]?.message;
				const content: AssistantMessage["content"] = [];
				if (msg?.content) content.push({ type: "text", text: msg.content });
				for (const tc of msg?.tool_calls ?? []) {
					content.push({
						type: "toolCall",
						id: tc.id,
						name: tc.function.name,
						arguments: safeJson(tc.function.arguments),
					});
				}
				const hasToolUse = content.some((c) => c.type === "toolCall");
				const finalMessage: AssistantMessage = {
					role: "assistant",
					content,
					api: "openai-completions",
					provider: model.provider,
					model: model.id,
					usage: EMPTY_USAGE,
					stopReason: hasToolUse ? "toolUse" : "stop",
					timestamp: Date.now(),
				};
				stream.push({
					type: "done",
					reason: hasToolUse ? "toolUse" : "stop",
					message: finalMessage,
				});
			} catch (err) {
				const aborted = signal?.aborted || (err as Error)?.name === "AbortError";
				const errorMessage: AssistantMessage = {
					role: "assistant",
					content: [],
					api: "openai-completions",
					provider: model.provider,
					model: model.id,
					usage: EMPTY_USAGE,
					stopReason: aborted ? "aborted" : "error",
					errorMessage: (err as Error).message,
					timestamp: Date.now(),
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

function safeJson(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw || "{}");
		return v && typeof v === "object" ? v : {};
	} catch {
		return {};
	}
}
