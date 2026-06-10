// Ambient-Typen für die pi-Pakete (nur die von der App genutzte Surface).
//
// Warum ambient statt echtem Source-Typecheck? Der pi-ai-Source referenziert
// optionale Provider-SDKs (openai, @mistralai, @google/genai) und node-Builtins,
// die im Browser-App-Kontext weder installiert noch gewünscht sind. Diese
// Deklarationen geben der App eine typisierte Schnittstelle, während Vite zur
// Laufzeit/zum Bundle die echten Quellen über die Shims aliasiert.

declare module "@earendil-works/pi-ai" {
	// TypeBox-Schema-Bausteine
	export const Type: {
		Object: (props: Record<string, unknown>, opts?: unknown) => TSchema;
		String: (opts?: { description?: string }) => TSchema;
		// Weitere TypeBox-Konstruktoren bei Bedarf hier ergänzen.
		[key: string]: (...args: never[]) => TSchema;
	};
	export type TSchema = { [key: string]: unknown };
	export type Static<_T> = Record<string, unknown>;

	export type Provider = string;
	export type Api = string;

	export interface Usage {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	}

	export interface Model<_TApi = string> {
		id: string;
		name: string;
		api: string;
		provider: Provider;
		baseUrl: string;
		reasoning: boolean;
		input: ("text" | "image")[];
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
		headers?: Record<string, string>;
	}

	export type TextContent = { type: "text"; text: string };
	export type ToolCallContent = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

	export interface AssistantMessage {
		role: "assistant";
		content: Array<TextContent | { type: "thinking"; thinking: string } | ToolCallContent>;
		api: string;
		provider: Provider;
		model: string;
		usage: Usage;
		stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
		errorMessage?: string;
		timestamp: number;
	}

	export interface Context {
		systemPrompt?: string;
		messages: Array<
			| { role: "user"; content: string | Array<TextContent> }
			| AssistantMessage
			| { role: "toolResult"; toolCallId: string; toolName: string; content: Array<TextContent> }
		>;
		tools?: Array<{ name: string; description: string; parameters: TSchema }>;
	}

	export interface StreamOptions {
		apiKey?: string;
		signal?: AbortSignal;
		[key: string]: unknown;
	}

	export function createAssistantMessageEventStream(): {
		push(event: unknown): void;
		end(result?: unknown): void;
		result(): Promise<AssistantMessage>;
		[Symbol.asyncIterator](): AsyncIterator<unknown>;
	};
}

declare module "@earendil-works/pi-agent-core" {
	import type { TSchema } from "@earendil-works/pi-ai";

	export interface AgentToolResult<T = unknown> {
		content: Array<{ type: "text"; text: string } | { type: "image"; [k: string]: unknown }>;
		details: T;
		terminate?: boolean;
	}

	export interface AgentTool<_TParams = TSchema, _TDetails = unknown> {
		name: string;
		label: string;
		description: string;
		parameters: TSchema;
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
		) => Promise<AgentToolResult>;
		executionMode?: "sequential" | "parallel";
	}

	export type AgentEvent =
		| { type: "agent_start" }
		| { type: "agent_end"; messages: unknown[] }
		| { type: "turn_start" }
		| { type: "turn_end"; message: unknown; toolResults: unknown[] }
		| { type: "message_start"; message: unknown }
		| { type: "message_update"; message: unknown; assistantMessageEvent: unknown }
		| { type: "message_end"; message: import("@earendil-works/pi-ai").AssistantMessage }
		| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
		| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
		| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

	export interface AgentOptions {
		initialState?: {
			systemPrompt?: string;
			model?: import("@earendil-works/pi-ai").Model;
			tools?: AgentTool[];
		};
		streamFn?: (...args: never[]) => unknown;
		toolExecution?: "sequential" | "parallel";
		[key: string]: unknown;
	}

	export class Agent {
		constructor(options?: AgentOptions);
		subscribe(listener: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void;
		prompt(input: string): Promise<void>;
		abort(): void;
		waitForIdle(): Promise<void>;
		get state(): { model: import("@earendil-works/pi-ai").Model; [key: string]: unknown };
	}
}
