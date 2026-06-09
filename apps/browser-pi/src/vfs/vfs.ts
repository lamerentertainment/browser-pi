// VFS — Virtual File System über IndexedDB.
//
// Stellt einen pfadbasierten Namensraum bereit (/cases, /prompts, /textblocks).
// SICHERHEITS-INVARIANTE (CLAUDE.md, Prinzip 3): kein Pfad darf aus dem
// VFS-Namensraum herausführen. normalizePath() lehnt absolute Ausbrüche und
// `..`-Traversal ab — Sandbox by construction, nicht per Konvention.

import { type FileRecord, idb } from "./idb.ts";

export class VfsError extends Error {
	constructor(
		public code: "not_found" | "is_directory" | "invalid_path" | "exists",
		message: string,
	) {
		super(message);
		this.name = "VfsError";
	}
}

/**
 * Normalisiert einen (ggf. relativen) Pfad gegen ein cwd zu einem absoluten
 * VFS-Pfad. Wirft bei jedem Versuch, den Wurzel-Namensraum zu verlassen.
 */
export function normalizePath(input: string, cwd = "/"): string {
	const raw = input.trim();
	if (raw === "") return cwd;
	const base = raw.startsWith("/") ? "/" : cwd;
	const segments = `${base}/${raw}`.split("/");
	const stack: string[] = [];
	for (const seg of segments) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (stack.length === 0) {
				// Versuch, über die Wurzel hinaus zu navigieren -> verboten.
				throw new VfsError("invalid_path", `Pfad verlässt den Namensraum: ${input}`);
			}
			stack.pop();
			continue;
		}
		if (seg.includes("\0")) {
			throw new VfsError("invalid_path", `Ungültiges Zeichen im Pfad: ${input}`);
		}
		stack.push(seg);
	}
	return `/${stack.join("/")}`;
}

export function dirname(path: string): string {
	const norm = normalizePath(path);
	if (norm === "/") return "/";
	const idx = norm.lastIndexOf("/");
	return idx <= 0 ? "/" : norm.slice(0, idx);
}

export function basename(path: string): string {
	const norm = normalizePath(path);
	const idx = norm.lastIndexOf("/");
	return norm.slice(idx + 1);
}

export interface DirEntry {
	name: string;
	path: string;
	type: "file" | "dir";
	size: number;
	mtime: number;
}

class Vfs {
	async readFile(path: string, cwd = "/"): Promise<string> {
		const norm = normalizePath(path, cwd);
		const rec = await idb.get(norm);
		if (!rec) {
			// Könnte ein "Verzeichnis" sein (existiert nur implizit über Kinder).
			if (await this.isDir(norm)) {
				throw new VfsError("is_directory", `${norm} ist ein Verzeichnis`);
			}
			throw new VfsError("not_found", `Keine Datei: ${norm}`);
		}
		return rec.content;
	}

	async writeFile(path: string, content: string, cwd = "/"): Promise<string> {
		const norm = normalizePath(path, cwd);
		if (norm === "/") throw new VfsError("invalid_path", "Kann Wurzel nicht schreiben");
		const record: FileRecord = { path: norm, content, mtime: Date.now() };
		await idb.put(record);
		return norm;
	}

	async exists(path: string, cwd = "/"): Promise<boolean> {
		const norm = normalizePath(path, cwd);
		if (await idb.get(norm)) return true;
		return this.isDir(norm);
	}

	async delete(path: string, cwd = "/"): Promise<number> {
		const norm = normalizePath(path, cwd);
		const keys = await idb.allKeys();
		const prefix = norm === "/" ? "/" : `${norm}/`;
		const toDelete = keys.filter((k) => k === norm || k.startsWith(prefix));
		await Promise.all(toDelete.map((k) => idb.delete(k)));
		return toDelete.length;
	}

	/** Ein Pfad ist ein "Verzeichnis", wenn irgendeine Datei darunter liegt. */
	async isDir(path: string): Promise<boolean> {
		const norm = normalizePath(path);
		if (norm === "/") return true;
		const keys = await idb.allKeys();
		const prefix = `${norm}/`;
		return keys.some((k) => k.startsWith(prefix));
	}

	/** Listet die direkten Kinder eines Verzeichnisses. */
	async list(path: string, cwd = "/"): Promise<DirEntry[]> {
		const norm = normalizePath(path, cwd);
		const all = await idb.all();
		const prefix = norm === "/" ? "/" : `${norm}/`;
		const dirs = new Map<string, DirEntry>();
		const files: DirEntry[] = [];
		for (const rec of all) {
			if (!rec.path.startsWith(prefix)) continue;
			const rest = rec.path.slice(prefix.length);
			if (rest === "") continue;
			const slash = rest.indexOf("/");
			if (slash === -1) {
				files.push({
					name: rest,
					path: rec.path,
					type: "file",
					size: rec.content.length,
					mtime: rec.mtime,
				});
			} else {
				const dirName = rest.slice(0, slash);
				const dirPath = `${prefix}${dirName}`;
				if (!dirs.has(dirPath)) {
					dirs.set(dirPath, {
						name: dirName,
						path: dirPath,
						type: "dir",
						size: 0,
						mtime: rec.mtime,
					});
				}
			}
		}
		return [...dirs.values(), ...files].sort((a, b) => {
			if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	/** Rekursive Auflistung aller Dateipfade unter einem Präfix. */
	async walk(path = "/", cwd = "/"): Promise<string[]> {
		const norm = normalizePath(path, cwd);
		const keys = await idb.allKeys();
		const prefix = norm === "/" ? "/" : `${norm}/`;
		return keys.filter((k) => norm === "/" || k === norm || k.startsWith(prefix)).sort();
	}

	/** Vollständiger Export als JSON (Backup / Geräte-Transfer ohne Cloud). */
	async exportAll(): Promise<FileRecord[]> {
		return idb.all();
	}

	async importAll(records: FileRecord[], opts: { overwrite?: boolean } = {}): Promise<number> {
		let n = 0;
		for (const rec of records) {
			const norm = normalizePath(rec.path);
			if (!opts.overwrite && (await idb.get(norm))) continue;
			await idb.put({ path: norm, content: rec.content, mtime: rec.mtime ?? Date.now() });
			n++;
		}
		return n;
	}
}

export const vfs = new Vfs();
