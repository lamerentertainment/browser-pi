// LLM-Client — spricht AUSSCHLIESSLICH einen lokalen, OpenAI-kompatiblen
// Endpoint an (Ollama / OpenWebUI). Kommerzielle Provider sind bewusst
// ausgeschlossen (CLAUDE.md, Prinzip 1).
//
// Der Call geht DIREKT vom Browser an den lokalen Endpoint, nie über den
// ausliefernden Server. Endpoint + Token sind nutzerkonfigurierbar und bleiben
// lokal. CORS muss am Endpoint erlaubt sein.
//
// Hinweis: Dieser Client ist absichtlich klein gehalten. In einer späteren
// Ausbaustufe lässt sich hier @earendil-works/pi-ai (openai-completions
// Provider mit custom baseURL) einsetzen, ohne die Aufrufer zu ändern.

export interface LlmConfig {
	baseUrl: string; // z.B. http://localhost:11434/v1  oder OpenWebUI-URL
	apiKey: string; // bleibt lokal; bei Ollama beliebig
	model: string; // z.B. "llama3.1" oder "qwen2.5"
}

export interface ToolSpec {
	name: string;
	description: string;
	parameters: Record<string, unknown>; // JSON-Schema
}

export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export interface ChatResponse {
	content: string | null;
	toolCalls: ToolCall[];
}

export async function chatCompletion(
	config: LlmConfig,
	messages: ChatMessage[],
	tools: ToolSpec[],
	signal?: AbortSignal,
): Promise<ChatResponse> {
	const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
	const body = {
		model: config.model,
		messages,
		tools: tools.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			},
		})),
		tool_choice: "auto",
		stream: false,
		// OpenWebUIs OpenAI-Kompat-Endpoint braucht chat_id, sonst 400
		// ('NoneType'.startswith). Leerstring genügt. Bewährt in
		// iusable_anonymization gegen denselben OpenWebUI-Server.
		chat_id: "",
	};

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`LLM-Endpoint ${res.status}: ${text || res.statusText}`);
	}

	const json = (await res.json()) as {
		choices?: Array<{
			message?: { content?: string | null; tool_calls?: ToolCall[] };
		}>;
	};
	const msg = json.choices?.[0]?.message;
	return {
		content: msg?.content ?? null,
		toolCalls: msg?.tool_calls ?? [],
	};
}

/** Prüft Erreichbarkeit/Modelle des lokalen Endpoints (für Settings-Panel). */
export async function listModels(config: Pick<LlmConfig, "baseUrl" | "apiKey">): Promise<string[]> {
	const url = `${config.baseUrl.replace(/\/$/, "")}/models`;
	const res = await fetch(url, {
		headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	const json = (await res.json()) as { data?: Array<{ id: string }> };
	return (json.data ?? []).map((m) => m.id);
}
