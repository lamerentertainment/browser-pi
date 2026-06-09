// Agenten-Event-Stream. Die Web-Render-Schicht (Terminal.vue) konsumiert genau
// diese Events — wir rendern den Event-Stream, nicht die TUI (CLAUDE.md).

export type AgentEvent =
	| { type: "user"; text: string }
	| { type: "assistant"; text: string }
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	| { type: "tool_result"; id: string; name: string; output: string; exitCode: number }
	| { type: "error"; text: string }
	| { type: "status"; text: string };

export type EventSink = (event: AgentEvent) => void;
