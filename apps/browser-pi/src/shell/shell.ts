// Simulierter Shell-Interpreter (CLAUDE.md, Prinzip 3 — Shell-Provider).
//
// Versteht eine kuratierte, sichere Befehlsmenge und operiert AUSSCHLIESSLICH
// auf dem VFS. Es gibt KEIN child_process, KEINEN Host-Zugriff, KEIN Netzwerk.
// Pipes (|) und Redirect (>, >>) werden unterstützt; Befehle ausserhalb der
// Whitelist werden mit "command not found" abgewiesen.

import { basename, normalizePath, vfs, VfsError } from "../vfs/vfs.ts";

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
		if (ch === "|" || ch === ">") {
			if (has) {
				tokens.push(cur);
				cur = "";
				has = false;
			}
			if (ch === ">" && input[i + 1] === ">") {
				tokens.push(">>");
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
		const { flags, args } = parseFlags(argv);
		const target = args[0] ?? ctx.cwd;
		try {
			const norm = normalizePath(target, ctx.cwd);
			// Datei statt Verzeichnis?
			if (!(await vfs.isDir(norm)) && (await vfs.exists(norm))) {
				return ok(`${basename(norm)}\n`);
			}
			const entries = await vfs.list(norm, ctx.cwd);
			if (flags.has("l")) {
				const lines = entries.map(
					(e) =>
						`${e.type === "dir" ? "d" : "-"} ${String(e.size).padStart(7)} ${e.name}${e.type === "dir" ? "/" : ""}`,
				);
				return ok(`${lines.join("\n")}${lines.length ? "\n" : ""}`);
			}
			const names = entries.map((e) => (e.type === "dir" ? `${e.name}/` : e.name));
			return ok(`${names.join("\n")}${names.length ? "\n" : ""}`);
		} catch (e) {
			return fail(`ls: ${(e as Error).message}\n`);
		}
	},

	cat: async (argv, _stdin, ctx) => {
		const { args } = parseFlags(argv);
		if (args.length === 0) return fail("cat: fehlender Operand\n");
		let out = "";
		for (const f of args) {
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
		try {
			const all = await vfs.walk(start, ctx.cwd);
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
		const files = args.slice(1);
		const matched: string[] = [];
		const showName = files.length > 1;
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

export async function runShell(input: string, ctx: ShellContext): Promise<ShellResult> {
	const trimmed = input.trim();
	if (trimmed === "") return ok();
	let stages: ParsedCommand[];
	try {
		stages = splitPipeline(tokenize(trimmed));
	} catch (e) {
		return fail(`${(e as Error).message}\n`, 2);
	}

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
