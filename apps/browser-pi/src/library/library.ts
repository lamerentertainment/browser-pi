// Bibliotheks-Modell — bildet die drei fachlichen Bereiche (CLAUDE.md,
// "Fachliche Dokument-Domänen") auf VFS-Präfixe ab. Der Anfänger sieht nur
// benannte Bereiche und Titel, NIE Pfade oder Slashes (CLAUDE.md,
// "Zielgruppe & Bedienkonzept"). Die Pfade bleiben reines Implementierungsdetail
// — derselbe Namensraum, auf dem der Agent mit seinen Tools arbeitet.

import { basename, dirname, vfs } from "../vfs/vfs.ts";

export type LibraryId = "prompts" | "textblocks" | "cases";

export interface LibraryDef {
	id: LibraryId;
	/** Angezeigter Bereichsname. */
	label: string;
	/** Beschriftung der „Neu"-Aktion. */
	newLabel: string;
	/** Feldbeschriftung im Anlege-Dialog. */
	newField: string;
	/** VFS-Präfix (im UI versteckt). */
	prefix: string;
	/** Fälle sind verschachtelt: ein Fall ist ein Ordner mit Dokumenten. */
	nested: boolean;
	/** Startinhalt beim Anlegen eines neuen Eintrags. */
	template: (title: string) => string;
}

export const LIBRARIES: LibraryDef[] = [
	{
		id: "prompts",
		label: "Vorlagen",
		newLabel: "Neue Vorlage",
		newField: "Titel der Vorlage",
		prefix: "/prompts",
		nested: false,
		template: (t) => `# ${t}\n\n`,
	},
	{
		id: "textblocks",
		label: "Textbausteine",
		newLabel: "Neuer Textbaustein",
		newField: "Titel des Textbausteins",
		prefix: "/textblocks",
		nested: false,
		template: (t) => `# ${t}\n\n`,
	},
	{
		id: "cases",
		label: "Fälle",
		newLabel: "Neuer Fall",
		newField: "Name des Falls",
		prefix: "/cases",
		nested: true,
		template: (t) => `# ${t} — Sachverhalt\n\n`,
	},
];

export interface LibraryEntry {
	/** Anzeige-Titel (H1 oder schön formatierter Dateiname). */
	title: string;
	/** VFS-Pfad (intern). */
	path: string;
	mtime: number;
	/** Nur bei Fällen: die Dokumente innerhalb des Falls. */
	documents?: LibraryEntry[];
}

/** Erste Markdown-H1 als Titel, sonst schön formatierter Dateiname. */
export function titleOf(content: string, path: string): string {
	const m = content.match(/^#\s+(.+?)\s*$/m);
	const h1 = m?.[1]?.trim();
	return h1 || prettify(basename(path));
}

/** Macht aus einem Dateinamen/Slug einen lesbaren Namen. */
function prettify(name: string): string {
	const base = name.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
	return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

/** Titel → dateisystemtauglicher Slug (ascii, klein, bindestrichgetrennt). */
export function slugify(title: string): string {
	const s = title
		.toLowerCase()
		.replace(/ß/g, "ss")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // kombinierende Diakritika entfernen
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return s || "unbenannt";
}

/** „README.md" u.ä. Gerüst-Dateien gehören nicht in die Anfänger-Ansicht. */
function isScaffold(name: string): boolean {
	return /^readme\.md$/i.test(name);
}

function sortByTitle(entries: LibraryEntry[]): LibraryEntry[] {
	return entries.sort((a, b) => a.title.localeCompare(b.title, "de"));
}

/** Lädt die Einträge einer Bibliothek mit aufgelösten Anzeige-Titeln. */
export async function loadLibrary(def: LibraryDef): Promise<LibraryEntry[]> {
	const top = await vfs.list(def.prefix);
	if (!def.nested) {
		const entries: LibraryEntry[] = [];
		for (const e of top) {
			if (e.type !== "file" || isScaffold(e.name)) continue;
			const content = await vfs.readFile(e.path);
			entries.push({ title: titleOf(content, e.path), path: e.path, mtime: e.mtime });
		}
		return sortByTitle(entries);
	}
	// Fälle: jeder Ordner ist ein Fall.
	const cases: LibraryEntry[] = [];
	for (const e of top) {
		if (e.type !== "dir") continue;
		const documents = await loadDocuments(e.path);
		cases.push({
			title: caseTitle(e.name, documents),
			path: e.path,
			mtime: e.mtime,
			documents,
		});
	}
	return sortByTitle(cases);
}

async function loadDocuments(folder: string): Promise<LibraryEntry[]> {
	const items = await vfs.list(folder);
	const docs: LibraryEntry[] = [];
	for (const it of items) {
		if (it.type !== "file") continue;
		const content = await vfs.readFile(it.path);
		docs.push({ title: titleOf(content, it.path), path: it.path, mtime: it.mtime });
	}
	return sortByTitle(docs);
}

/** Fall-Titel aus dem Sachverhalt-Dokument (ohne Untertitel „— Sachverhalt"). */
function caseTitle(folderName: string, documents: LibraryEntry[]): string {
	const lead = documents.find((d) => /sachverhalt/i.test(d.path)) ?? documents[0];
	const title = lead?.title.replace(/\s*—.*$/, "").trim();
	return title || prettify(folderName);
}

/** Findet einen noch freien Pfad, hängt bei Kollision -2, -3, … an. */
async function uniquePath(dir: string, slug: string, ext = ".md"): Promise<string> {
	let candidate = `${dir}/${slug}${ext}`;
	let n = 2;
	while (await vfs.exists(candidate)) {
		candidate = `${dir}/${slug}-${n}${ext}`;
		n++;
	}
	return candidate;
}

/**
 * Legt einen neuen Eintrag an und gibt dessen Pfad zurück. Für Fälle entsteht
 * ein Ordner mit Start-Dokument; für Vorlagen/Textbausteine eine einzelne Datei.
 * Der Nutzer nennt nur einen Titel — der Pfad wird daraus abgeleitet.
 */
export async function createEntry(def: LibraryDef, title: string): Promise<string> {
	const slug = slugify(title);
	if (def.nested) {
		let folder = `${def.prefix}/${slug}`;
		let n = 2;
		while (await vfs.exists(folder)) {
			folder = `${def.prefix}/${slug}-${n}`;
			n++;
		}
		const path = `${folder}/sachverhalt.md`;
		await vfs.writeFile(path, def.template(title));
		return path;
	}
	const path = await uniquePath(def.prefix, slug);
	await vfs.writeFile(path, def.template(title));
	return path;
}

export interface ParsedDoc {
	/** Titel aus der ersten H1. */
	title: string;
	/** Restlicher Inhalt ohne die H1-Zeile. */
	body: string;
}

/** Trennt Titel (H1) und Rumpf, damit der Editor beides getrennt zeigt. */
export function parseDoc(content: string): ParsedDoc {
	const m = content.match(/^\s*#\s+(.+?)[ \t]*(?:\r?\n|$)/);
	if (!m) return { title: "", body: content };
	return { title: m[1].trim(), body: content.slice(m[0].length).replace(/^\r?\n+/, "") };
}

/** Setzt Titel (als H1) und Rumpf wieder zu einem Markdown-Dokument zusammen. */
export function serializeDoc(title: string, body: string): string {
	const t = title.trim();
	const b = body.replace(/^\r?\n+/, "");
	if (!t) return b;
	return b ? `# ${t}\n\n${b}` : `# ${t}\n`;
}

/**
 * Speichert Titel + Inhalt. Ändert sich der Titel, wird die Datei zusätzlich auf
 * einen passenden Slug umbenannt (hält den agent-sichtbaren Pfad sprechend).
 * Gibt den finalen Pfad zurück (kann sich durch Umbenennen geändert haben).
 */
export async function saveEntry(path: string, title: string, body: string): Promise<string> {
	await vfs.writeFile(path, serializeDoc(title, body));
	const desired = slugify(title);
	const currentBase = basename(path).replace(/\.md$/i, "");
	if (!title.trim() || desired === currentBase) return path;
	const target = await uniquePath(dirname(path), desired);
	await vfs.move(path, target);
	return target;
}

/** Dupliziert einen Eintrag als „… (Kopie)" im selben Bereich. */
export async function duplicateEntry(path: string): Promise<string> {
	const content = await vfs.readFile(path);
	const { title, body } = parseDoc(content);
	const newTitle = `${title || prettify(basename(path))} (Kopie)`;
	const target = await uniquePath(dirname(path), slugify(newTitle));
	await vfs.writeFile(target, serializeDoc(newTitle, body));
	return target;
}

/** Löscht einen Eintrag (Datei) oder einen ganzen Fall-Ordner. */
export async function deleteEntry(path: string): Promise<void> {
	await vfs.delete(path);
}

/** Legt ein neues Dokument innerhalb eines Falls an. */
export async function createDocument(caseFolder: string, title: string): Promise<string> {
	const target = await uniquePath(caseFolder, slugify(title));
	await vfs.writeFile(target, `# ${title}\n\n`);
	return target;
}
