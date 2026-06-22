// AgentTools für pi-agent-core. Jedes Tool delegiert an die injizierte
// VFS-/Shell-Sandbox — identische Sicherheits-Invariante wie zuvor, nur als
// echte pi-AgentTool-Definitionen (TypeBox-Schema, execute -> AgentToolResult).
// UI und Sandbox bleiben unberührt; nur die Tool-Hülle ist die pi-native.

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "@earendil-works/pi-ai";
import { runShell, type ShellContext } from "../shell/shell.ts";
import { vfs } from "../vfs/vfs.ts";
import { isPathBlocked } from "../store/agentAccess.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: undefined };
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));

const BashSchema = Type.Object({ command: Type.String({ description: "Der auszuführende Befehl" }) });
const ReadSchema = Type.Object({ path: Type.String({ description: "Pfad zur Datei" }) });
const WriteSchema = Type.Object({
	path: Type.String({ description: "Pfad zur Datei" }),
	content: Type.String({ description: "Vollständiger Dateiinhalt" }),
});
const EditSchema = Type.Object({
	path: Type.String(),
	old_string: Type.String(),
	new_string: Type.String(),
});

/** Baut die Tool-Liste; alle Tools teilen sich ein cwd (ShellContext). */
export function createPiTools(ctx: ShellContext): AgentTool<TSchema>[] {
	const bash: AgentTool = {
		name: "bash",
		label: "Shell",
		description:
			"Führt einen Shell-Befehl im sandboxierten Dokumenten-Dateisystem aus. " +
			"Erlaubt: ls, cat, grep, find, write, mkdir, rm, echo, wc, head, pwd, cd. " +
			"Unterstützt Pipes (|) und Redirects (>, >>). Kein Host-/Netzwerkzugriff.",
		parameters: BashSchema,
		execute: async (_id, params) => {
			const r = await runShell(str(params.command), ctx);
			return text((r.stdout + r.stderr) || "(keine Ausgabe)");
		},
	};

	const read: AgentTool = {
		name: "read",
		label: "Datei lesen",
		description:
			"Liest eine Datei aus dem Dokumenten-Dateisystem als Text. Funktioniert " +
			"für JEDE Datei unabhängig von der Endung — auch .pdf und .docx: deren " +
			"Text wurde beim Hochladen extrahiert und wird hier direkt zurückgegeben.",
		parameters: ReadSchema,
		execute: async (_id, params) => {
			if (isPathBlocked(str(params.path), ctx.cwd))
				return text(`Fehler: Zugriff auf ${params.path} verweigert.`);
			try {
				return text(await vfs.readFile(str(params.path), ctx.cwd));
			} catch (e) {
				return text(`Fehler: ${(e as Error).message}`);
			}
		},
	};

	const write: AgentTool = {
		name: "write",
		label: "Datei schreiben",
		description: "Schreibt (oder überschreibt) eine Datei im Dokumenten-Dateisystem.",
		parameters: WriteSchema,
		execute: async (_id, params) => {
			if (isPathBlocked(str(params.path), ctx.cwd))
				return text(`Fehler: Zugriff auf ${params.path} verweigert.`);
			try {
				const p = await vfs.writeFile(str(params.path), str(params.content), ctx.cwd);
				return text(`Geschrieben: ${p}`);
			} catch (e) {
				return text(`Fehler: ${(e as Error).message}`);
			}
		},
	};

	const edit: AgentTool = {
		name: "edit",
		label: "Datei bearbeiten",
		description: "Ersetzt in einer Datei das erste Vorkommen von old_string durch new_string.",
		parameters: EditSchema,
		execute: async (_id, params) => {
			if (isPathBlocked(str(params.path), ctx.cwd))
				return text(`Fehler: Zugriff auf ${params.path} verweigert.`);
			try {
				const path = str(params.path);
				const oldStr = str(params.old_string);
				const content = await vfs.readFile(path, ctx.cwd);
				if (!content.includes(oldStr)) {
					return text("Fehler: old_string nicht gefunden");
				}
				const p = await vfs.writeFile(path, content.replace(oldStr, str(params.new_string)), ctx.cwd);
				return text(`Bearbeitet: ${p}`);
			} catch (e) {
				return text(`Fehler: ${(e as Error).message}`);
			}
		},
	};

	return [bash, read, write, edit] as unknown as AgentTool<TSchema>[];
}
