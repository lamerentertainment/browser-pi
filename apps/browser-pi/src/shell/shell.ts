// Simulierter Shell-Interpreter (CLAUDE.md, Prinzip 3 — Shell-Provider).
//
// Versteht eine kuratierte, sichere Befehlsmenge und operiert AUSSCHLIESSLICH
// auf dem VFS. Es gibt KEIN child_process, KEINEN Host-Zugriff, KEIN Netzwerk.
// Pipes (|) und Redirect (>, >>) werden unterstützt; Befehle ausserhalb der
// Whitelist werden mit "command not found" abgewiesen.

import { basename, type DirEntry, normalizePath, vfs, VfsError } from "../vfs/vfs.ts";
import { isPathBlocked } from "../store/agentAccess.ts";

export interface ShellResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ShellContext {
	cwd: string;
}

type Argv = string[];

// ---------------------------------------------------------------------------
// Tokenizer: respektiert einfache/doppelte Quotes; trennt | und Redirects.
// ---------------------------------------------------------------------------

interface ParsedCommand {
	argv: Argv;
	redirect?: { mode: "write" | "append"; target: string };
}

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let cur = "";
	let quote: '"' | "'" | null = null;
	let has = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
			has = true;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			has = true;
			continue;
		}
		if (ch === " " || ch === "\t") {
			if (has) {
				tokens.push(cur);
				cur = "";
				has = false;
			}
			continue;
		}
		// Einzelnes & (Hintergrundausführung) gilt als Literal, nicht als Operator.
		if (ch === "&" && input[i + 1] !== "&") {
			cur += ch;
			has = true;
			continue;
		}
		// Befehlstrenner und Operatoren: | && ; > >>
		if (ch === "|" || ch === ">" || ch === ";" || ch === "&") {
			if (has) {
				tokens.push(cur);
				cur = "";
				has = false;
			}
			if (ch === ">" && input[i + 1] === ">") {
				tokens.push(">>");
				i++;
			} else if (ch === "&") {
				tokens.push("&&");
				i++;
			} else {
				tokens.push(ch);
			}
			continue;
		}
		cur += ch;
		has = true;
	}
	if (has) tokens.push(cur);
	return tokens;
}

// Eine Befehlsliste: Pipelines, verbunden über && (nur bei Erfolg) oder ; (immer).
interface ListSegment {
	tokens: string[];
	// Operator VOR diesem Segment ("first" für das erste).
	op: "&&" | ";" | "first";
}

function splitList(tokens: string[]): ListSegment[] {
	const segments: ListSegment[] = [];
	let cur: string[] = [];
	let op: ListSegment["op"] = "first";
	const flush = (next: ListSegment["op"]) => {
		if (cur.length) segments.push({ tokens: cur, op });
		cur = [];
		op = next;
	};
	for (const t of tokens) {
		if (t === "&&" || t === ";") {
			flush(t);
		} else {
			cur.push(t);
		}
	}
	flush("first");
	return segments;
}

function splitPipeline(tokens: string[]): ParsedCommand[] {
	const stages: ParsedCommand[] = [];
	let argv: Argv = [];
	let redirect: ParsedCommand["redirect"];
	const flush = () => {
		if (argv.length || redirect) stages.push({ argv, redirect });
		argv = [];
		redirect = undefined;
	};
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "|") {
			flush();
		} else if (t === ">" || t === ">>") {
			const target = tokens[++i];
			if (!target) throw new Error("syntax error: erwartete Datei nach Redirect");
			redirect = { mode: t === ">>" ? "append" : "write", target };
		} else {
			argv.push(t);
		}
	}
	flush();
	return stages;
}

// ---------------------------------------------------------------------------
// Builtins
// ---------------------------------------------------------------------------

type Builtin = (
	argv: Argv,
	stdin: string,
	ctx: ShellContext,
) => Promise<ShellResult>;

const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string, code = 1): ShellResult => ({ stdout: "", stderr, exitCode: code });

// Trennt Flags (-x) von Positionsargumenten.
function parseFlags(argv: Argv): { flags: Set<string>; args: string[] } {
	const flags = new Set<string>();
	const args: string[] = [];
	for (const a of argv.slice(1)) {
		if (a.startsWith("-") && a.length > 1) {
			for (const c of a.slice(1)) flags.add(c);
		} else {
			args.push(a);
		}
	}
	return { flags, args };
}

const builtins: Record<string, Builtin> = {
	echo: async (argv) => ok(`${argv.slice(1).join(" ")}\n`),

	pwd: async (_argv, _stdin, ctx) => ok(`${ctx.cwd}\n`),

	cd: async (argv, _stdin, ctx) => {
		const target = argv[1] ?? "/";
		try {
			const norm = normalizePath(target, ctx.cwd);
			if (norm !== "/" && !(await vfs.isDir(norm))) {
				return fail(`cd: kein Verzeichnis: ${target}\n`);
			}
			ctx.cwd = norm;
			return ok();
		} catch (e) {
			return fail(`cd: ${(e as Error).message}\n`);
		}
	},

	ls: async (argv, _stdin, ctx) => {
		// Unterstützt -l (lang), -R (rekursiv), -a (versteckte .-Einträge) und
		// mehrere Pfade. Nicht existente Pfade -> Fehler (nicht stille Leere).
		const { flags, args } = parseFlags(argv);
		const targets = args.length ? args : [ctx.cwd];
		const recursive = flags.has("R");
		const showHeaders = recursive || targets.length > 1;
		const out: string[] = [];
		const errs: string[] = [];

		const formatEntry = (e: DirEntry): string =>
			flags.has("l")
				? `${e.type === "dir" ? "d" : "-"} ${String(e.size).padStart(7)} ${e.name}${e.type === "dir" ? "/" : ""}`
				: e.type === "dir"
					? `${e.name}/`
					: e.name;

		const listDir = async (norm: string): Promise<DirEntry[]> => {
			const entries = await vfs.list(norm, ctx.cwd);
			return flags.has("a") ? entries : entries.filter((e) => !e.name.startsWith("."));
		};

		const renderDir = async (norm: string): Promise<void> => {
			if (isPathBlocked(norm)) {
				errs.push(`ls: ${norm}: Zugriff verweigert`);
				return;
			}
			const entries = (await listDir(norm)).filter((e) => !isPathBlocked(e.path));
			if (showHeaders) out.push(`${norm}:`);
			for (const e of entries) out.push(formatEntry(e));
			if (showHeaders) out.push("");
			if (recursive) {
				for (const e of entries) {
					if (e.type === "dir") await renderDir(e.path);
				}
			}
		};

		for (const target of targets) {
			try {
				const norm = normalizePath(target, ctx.cwd);
				if (await vfs.isDir(norm)) {
					await renderDir(norm);
				} else if (await vfs.exists(norm)) {
					out.push(formatEntry({ name: basename(norm), path: norm, type: "file", size: 0, mtime: 0 }));
				} else {
					errs.push(`ls: ${target}: Datei oder Verzeichnis nicht gefunden`);
				}
			} catch (e) {
				errs.push(`ls: ${(e as Error).message}`);
			}
		}

		const stdout = out.join("\n").replace(/\n+$/, "");
		return {
			stdout: stdout ? `${stdout}\n` : "",
			stderr: errs.length ? `${errs.join("\n")}\n` : "",
			exitCode: errs.length ? 1 : 0,
		};
	},

	cat: async (argv, _stdin, ctx) => {
		const { args } = parseFlags(argv);
		if (args.length === 0) return fail("cat: fehlender Operand\n");
		let out = "";
		for (const f of args) {
			if (isPathBlocked(f, ctx.cwd)) return fail(`cat: ${f}: Zugriff verweigert\n`);
			try {
				out += await vfs.readFile(f, ctx.cwd);
			} catch (e) {
				return fail(`cat: ${f}: ${describeErr(e)}\n`);
			}
		}
		return ok(out);
	},

	find: async (argv, _stdin, ctx) => {
		// find [pfad] [-name muster]
		const start = argv[1] && !argv[1].startsWith("-") ? argv[1] : ctx.cwd;
		const nameIdx = argv.indexOf("-name");
		const pattern = nameIdx !== -1 ? argv[nameIdx + 1] : undefined;
		if (isPathBlocked(start, ctx.cwd)) return fail(`find: ${start}: Zugriff verweigert\n`);
		try {
			const all = (await vfs.walk(start, ctx.cwd)).filter((p) => !isPathBlocked(p));
			const matches = pattern
				? all.filter((p) => globToRegex(pattern).test(basename(p)))
				: all;
			return ok(`${matches.join("\n")}${matches.length ? "\n" : ""}`);
		} catch (e) {
			return fail(`find: ${(e as Error).message}\n`);
		}
	},

	grep: async (argv, stdin, ctx) => {
		const { flags, args } = parseFlags(argv);
		const pattern = args[0];
		if (pattern === undefined) return fail("grep: fehlendes Muster\n");
		const re = new RegExp(pattern, flags.has("i") ? "i" : undefined);
		const recursive = flags.has("r") || flags.has("R");
		const operands = args.slice(1);
		const matched: string[] = [];

		// Bei -r jedes Argument (Verzeichnis oder Datei) zum Dateibaum expandieren.
		let files = operands.filter((f) => !isPathBlocked(f, ctx.cwd));
		if (recursive) {
			const targets = operands.length ? operands : [ctx.cwd];
			files = [];
			try {
				for (const t of targets) {
					if (isPathBlocked(t, ctx.cwd)) continue;
					files.push(...(await vfs.walk(t, ctx.cwd)).filter((p) => !isPathBlocked(p)));
				}
			} catch (e) {
				return fail(`grep: ${(e as Error).message}\n`);
			}
		}

		const showName = recursive || files.length > 1;
		const scan = (text: string, label?: string) => {
			for (const line of text.split("\n")) {
				if (re.test(line)) matched.push(label ? `${label}:${line}` : line);
			}
		};
		if (files.length === 0) {
			scan(stdin);
		} else {
			for (const f of files) {
				try {
					scan(await vfs.readFile(f, ctx.cwd), showName ? f : undefined);
				} catch (e) {
					if (recursive) continue; // Platzhalter/Verzeichnisse überspringen.
					return fail(`grep: ${f}: ${describeErr(e)}\n`);
				}
			}
		}
		return matched.length ? ok(`${matched.join("\n")}\n`) : { stdout: "", stderr: "", exitCode: 1 };
	},

	mkdir: async (argv, _stdin, ctx) => {
		// VFS hat keine echten Verzeichnisse; lege Platzhalter (.keep) an.
		const { args } = parseFlags(argv);
		if (args.length === 0) return fail("mkdir: fehlender Operand\n");
		for (const d of args) {
			await vfs.writeFile(`${d.replace(/\/$/, "")}/.keep`, "", ctx.cwd);
		}
		return ok();
	},

	write: async (argv, stdin, ctx) => {
		// write <pfad> [inhalt...] — Komfort-Befehl; sonst via Redirect.
		const { args } = parseFlags(argv);
		const target = args[0];
		if (!target) return fail("write: fehlender Pfad\n");
		if (isPathBlocked(target, ctx.cwd)) return fail(`write: ${target}: Zugriff verweigert\n`);
		const content = args.length > 1 ? args.slice(1).join(" ") : stdin;
		try {
			const p = await vfs.writeFile(target, content, ctx.cwd);
			return ok(`geschrieben: ${p}\n`);
		} catch (e) {
			return fail(`write: ${describeErr(e)}\n`);
		}
	},

	rm: async (argv, _stdin, ctx) => {
		const { args } = parseFlags(argv);
		if (args.length === 0) return fail("rm: fehlender Operand\n");
		let n = 0;
		for (const f of args) {
			if (isPathBlocked(f, ctx.cwd)) return fail(`rm: ${f}: Zugriff verweigert\n`);
			try {
				n += await vfs.delete(f, ctx.cwd);
			} catch (e) {
				return fail(`rm: ${f}: ${describeErr(e)}\n`);
			}
		}
		return n > 0 ? ok() : fail("rm: nichts gelöscht\n");
	},

	wc: async (argv, stdin, ctx) => {
		const { flags, args } = parseFlags(argv);
		if (args[0] && isPathBlocked(args[0], ctx.cwd)) return fail(`wc: ${args[0]}: Zugriff verweigert\n`);
		const text = args[0] ? await vfs.readFile(args[0], ctx.cwd).catch(() => "") : stdin;
		const lines = text === "" ? 0 : text.split("\n").length;
		const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
		const chars = text.length;
		if (flags.has("l")) return ok(`${lines}\n`);
		if (flags.has("w")) return ok(`${words}\n`);
		return ok(`${lines} ${words} ${chars}\n`);
	},

	head: async (argv, stdin, ctx) => {
		const { flags, args } = parseFlags(argv);
		const n = flags.has("n") ? 10 : 10;
		if (args[0] && isPathBlocked(args[0], ctx.cwd)) return fail(`head: ${args[0]}: Zugriff verweigert\n`);
		const text = args[0] ? await vfs.readFile(args[0], ctx.cwd).catch(() => stdin) : stdin;
		return ok(`${text.split("\n").slice(0, n).join("\n")}\n`);
	},

	help: async () =>
		ok(
			`Verfügbare Befehle (Sandbox auf VFS):\n${Object.keys(builtins).sort().join(", ")}\n` +
				"Unterstützt: Pipes (|), Redirect (>, >>), Quotes.\n",
		),
};

function describeErr(e: unknown): string {
	if (e instanceof VfsError) {
		if (e.code === "not_found") return "Datei oder Verzeichnis nicht gefunden";
		if (e.code === "is_directory") return "ist ein Verzeichnis";
		return e.message;
	}
	return (e as Error).message;
}

// Sehr einfaches Globbing für -name Muster (*, ?).
function globToRegex(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	const re = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${re}$`);
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

export const ALLOWED_COMMANDS = Object.keys(builtins);

// Führt eine einzelne Pipeline (durch | verbundene Stufen) aus.
async function runPipeline(stages: ParsedCommand[], ctx: ShellContext): Promise<ShellResult> {
	let stdin = "";
	let last: ShellResult = ok();
	for (let i = 0; i < stages.length; i++) {
		const stage = stages[i];
		const cmd = stage.argv[0];
		const builtin = builtins[cmd];
		if (!builtin) {
			return fail(
				`${cmd}: command not found (Sandbox erlaubt nur: ${ALLOWED_COMMANDS.join(", ")})\n`,
				127,
			);
		}
		last = await builtin(stage.argv, stdin, ctx);
		// Redirect der letzten Stufe in eine VFS-Datei.
		if (stage.redirect) {
			if (isPathBlocked(stage.redirect.target, ctx.cwd)) {
				return fail(`redirect: ${stage.redirect.target}: Zugriff verweigert\n`);
			}
			try {
				const prev =
					stage.redirect.mode === "append"
						? await vfs.readFile(stage.redirect.target, ctx.cwd).catch(() => "")
						: "";
				await vfs.writeFile(stage.redirect.target, prev + last.stdout, ctx.cwd);
				last = { ...last, stdout: "" };
			} catch (e) {
				return fail(`redirect: ${describeErr(e)}\n`);
			}
		}
		stdin = last.stdout;
	}
	return last;
}

export async function runShell(input: string, ctx: ShellContext): Promise<ShellResult> {
	const trimmed = input.trim();
	if (trimmed === "") return ok();
	let segments: ListSegment[];
	try {
		segments = splitList(tokenize(trimmed));
	} catch (e) {
		return fail(`${(e as Error).message}\n`, 2);
	}

	// Befehlsliste ausführen: stdout/stderr aller Segmente aufsammeln,
	// && bricht die Kette bei Fehler ab, ; läuft unabhängig weiter.
	let stdout = "";
	let stderr = "";
	let last: ShellResult = ok();
	for (const seg of segments) {
		if (seg.op === "&&" && last.exitCode !== 0) continue;
		let stages: ParsedCommand[];
		try {
			stages = splitPipeline(seg.tokens);
		} catch (e) {
			last = fail(`${(e as Error).message}\n`, 2);
			stderr += last.stderr;
			continue;
		}
		last = await runPipeline(stages, ctx);
		stdout += last.stdout;
		stderr += last.stderr;
	}
	return { stdout, stderr, exitCode: last.exitCode };
}
