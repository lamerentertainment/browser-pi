// Agenten-Event-Stream. Die Web-Render-Schicht (Terminal.vue) konsumiert genau
// diese Events — wir rendern den Event-Stream, nicht die TUI (CLAUDE.md).
//
// `streaming: true` markiert ein Event, das sich noch füllt (Token-für-Token).
// Die UI ersetzt das jeweils letzte Streaming-Event gleichen Typs, statt jedes
// Delta als neue Zeile anzuhängen (siehe App.vue). Das letzte Delta eines
// Blocks wird ohne `streaming` (bzw. `streaming: false`) gesendet und damit
// "eingefroren".

export type AgentEvent =
	| { type: "user"; text: string }
	| { type: "reasoning"; text: string; streaming?: boolean }
	| { type: "assistant"; text: string; streaming?: boolean }
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	| { type: "tool_result"; id: string; name: string; output: string; exitCode: number }
	| { type: "error"; text: string }
	| { type: "status"; text: string };

export type EventSink = (event: AgentEvent) => void;
