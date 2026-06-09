// Agenten-Tools. Jedes FS-/Shell-berührende Tool delegiert an die injizierte
// VFS-/Shell-Schicht (CLAUDE.md, Prinzip 3 — Sandbox by construction).
// Es gibt KEINEN Pfad zum Host: alle Tools enden im VFS bzw. im simulierten
// Shell-Interpreter.

import { runShell, type ShellContext } from "../shell/shell.ts";
import { vfs } from "../vfs/vfs.ts";
import type { ToolSpec } from "./llm.ts";

export interface ToolRuntime {
	ctx: ShellContext; // gemeinsames cwd für die Session
}

export interface ToolImpl {
	spec: ToolSpec;
	run: (args: Record<string, unknown>, rt: ToolRuntime) => Promise<{ output: string; exitCode: number }>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));

export const TOOLS: ToolImpl[] = [
	{
		spec: {
			name: "bash",
			description:
				"Führt einen Shell-Befehl im sandboxierten Dokumenten-Dateisystem aus. " +
				"Erlaubt: ls, cat, grep, find, write, mkdir, rm, echo, wc, head, pwd, cd. " +
				"Unterstützt Pipes (|) und Redirects (>, >>). Kein Host-/Netzwerkzugriff.",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "Der auszuführende Befehl" },
				},
				required: ["command"],
			},
		},
		run: async (args, rt) => {
			const r = await runShell(str(args.command), rt.ctx);
			return { output: (r.stdout + r.stderr) || "(keine Ausgabe)", exitCode: r.exitCode };
		},
	},
	{
		spec: {
			name: "read",
			description: "Liest eine Datei aus dem Dokumenten-Dateisystem.",
			parameters: {
				type: "object",
				properties: { path: { type: "string", description: "Pfad zur Datei" } },
				required: ["path"],
			},
		},
		run: async (args, rt) => {
			try {
				const content = await vfs.readFile(str(args.path), rt.ctx.cwd);
				return { output: content, exitCode: 0 };
			} catch (e) {
				return { output: `Fehler: ${(e as Error).message}`, exitCode: 1 };
			}
		},
	},
	{
		spec: {
			name: "write",
			description: "Schreibt (oder überschreibt) eine Datei im Dokumenten-Dateisystem.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Pfad zur Datei" },
					content: { type: "string", description: "Vollständiger Dateiinhalt" },
				},
				required: ["path", "content"],
			},
		},
		run: async (args, rt) => {
			try {
				const p = await vfs.writeFile(str(args.path), str(args.content), rt.ctx.cwd);
				return { output: `Geschrieben: ${p}`, exitCode: 0 };
			} catch (e) {
				return { output: `Fehler: ${(e as Error).message}`, exitCode: 1 };
			}
		},
	},
	{
		spec: {
			name: "edit",
			description:
				"Ersetzt in einer Datei das erste Vorkommen von old_string durch new_string.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					old_string: { type: "string" },
					new_string: { type: "string" },
				},
				required: ["path", "old_string", "new_string"],
			},
		},
		run: async (args, rt) => {
			try {
				const content = await vfs.readFile(str(args.path), rt.ctx.cwd);
				const oldStr = str(args.old_string);
				if (!content.includes(oldStr)) {
					return { output: "Fehler: old_string nicht gefunden", exitCode: 1 };
				}
				const updated = content.replace(oldStr, str(args.new_string));
				const p = await vfs.writeFile(str(args.path), updated, rt.ctx.cwd);
				return { output: `Bearbeitet: ${p}`, exitCode: 0 };
			} catch (e) {
				return { output: `Fehler: ${(e as Error).message}`, exitCode: 1 };
			}
		},
	},
	{
		spec: {
			name: "ls",
			description: "Listet den Inhalt eines Verzeichnisses im Dokumenten-Dateisystem.",
			parameters: {
				type: "object",
				properties: { path: { type: "string", description: "Verzeichnis (Default: /)" } },
			},
		},
		run: async (args, rt) => {
			const r = await runShell(`ls -l ${args.path ? str(args.path) : ""}`, rt.ctx);
			return { output: (r.stdout + r.stderr) || "(leer)", exitCode: r.exitCode };
		},
	},
];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);

export function getTool(name: string): ToolImpl | undefined {
	return TOOLS.find((t) => t.spec.name === name);
}
