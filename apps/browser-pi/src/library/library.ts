// Bibliotheks-Modell — bildet die drei fachlichen Bereiche (CLAUDE.md,
// "Fachliche Dokument-Domänen") auf VFS-Präfixe ab. Der Anfänger sieht nur
// benannte Bereiche und Titel, NIE Pfade oder Slashes (CLAUDE.md,
// "Zielgruppe & Bedienkonzept"). Die Pfade bleiben reines Implementierungsdetail
// — derselbe Namensraum, auf dem der Agent mit seinen Tools arbeitet.

import { extractDocxBlob, extractText, DOCX_MIME } from "../import/extract.ts";
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
		label: "Prompts",
		newLabel: "Neuer Prompt",
		newField: "Titel des Prompts",
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
	/** MIME-Typ bei importierten Binärdokumenten (PDF/DOCX/TXT); sonst leer. */
	mime?: string;
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
		const rec = await vfs.getRecord(it.path);
		// Importierte Binärdokumente tragen ihren Originaldateinamen als Titel; der
		// extrahierte Text hat keine Markdown-H1, die titleOf erkennen könnte.
		const title = rec?.mime
			? fileLabel(basename(it.path))
			: titleOf(rec?.content ?? "", it.path);
		docs.push({ title, path: it.path, mtime: it.mtime, mime: rec?.mime });
	}
	return sortByTitle(docs);
}

/** Dateiname für die Anzeige aufbereiten, Endung behalten (z.B. "Haftbefehl.pdf"). */
function fileLabel(name: string): string {
	const dot = name.lastIndexOf(".");
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : "";
	const pretty = base.replace(/[-_]+/g, " ").trim();
	return `${pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : name}${ext}`;
}

/**
 * Das namengebende Leitdokument eines Falls: exakt die Datei „sachverhalt.md".
 * Bewusst KEINE Pfad-Regex und KEIN Fallback auf documents[0] — sonst kippt der
 * Fall-Name, sobald man ein Dokument hochlädt, dessen Name „Sachverhalt" enthält
 * oder das alphabetisch vor das bisherige Leitdokument einsortiert.
 */
function leadDocument(documents: LibraryEntry[]): LibraryEntry | undefined {
	return documents.find((d) => basename(d.path).toLowerCase() === "sachverhalt.md");
}

/** Fall-Titel aus dem Sachverhalt-Dokument (ohne Untertitel „— Sachverhalt"). */
function caseTitle(folderName: string, documents: LibraryEntry[]): string {
	const title = leadDocument(documents)?.title.replace(/\s*—.*$/, "").trim();
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

/**
 * Benennt einen Fall um. Zwei Wirkungen, passend zu den zwei Sichten auf den
 * Namensraum (CLAUDE.md, „Zwei Wege auf dieselben Daten"):
 *  1. Der H1-Titel im Leitdokument (Sachverhalt) wird angepasst — er treibt den
 *     in der UI angezeigten Fall-Namen (siehe caseTitle).
 *  2. Der Fall-Ordner wird auf einen neuen Slug umbenannt — er treibt den
 *     agent-sichtbaren Pfad und bleibt so sprechend.
 * Gibt den (ggf. neuen) Ordner-Pfad zurück.
 */
export async function renameCase(caseFolder: string, newTitle: string): Promise<string> {
	const title = newTitle.trim();
	if (!title) return caseFolder;
	// 1. H1 im Leitdokument (sachverhalt.md) anpassen — es treibt den Anzeige-Titel.
	const documents = await loadDocuments(caseFolder);
	const lead = leadDocument(documents);
	if (lead) {
		const { body } = parseDoc(await vfs.readFile(lead.path));
		await vfs.writeFile(lead.path, serializeDoc(title, body));
	}
	// 2. Ordner-Slug umbenennen, falls er sich ändert.
	const desired = slugify(title);
	if (desired === basename(caseFolder)) return caseFolder;
	const parent = dirname(caseFolder);
	let target = `${parent}/${desired}`;
	let n = 2;
	while (await vfs.exists(target)) {
		target = `${parent}/${desired}-${n}`;
		n++;
	}
	await vfs.move(caseFolder, target);
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

/**
 * Speichert ein per SuperDoc bearbeitetes DOCX zurück ins VFS. Aktualisiert
 * sowohl den Blob (Original bleibt erhalten) als auch den extrahierten Text
 * (agent-lesbarer Index). Gibt den unveränderten Pfad zurück.
 */
export async function saveDocxBlob(path: string, blob: Blob): Promise<void> {
	const text = await extractDocxBlob(blob);
	await vfs.writeFile(path, text, "/", { mime: DOCX_MIME, blob });
}

/**
 * Importiert eine hochgeladene Datei (PDF/DOCX/TXT) als Dokument in einen Fall.
 * Das Original bleibt als Blob erhalten (Mensch sieht es), der extrahierte Text
 * wird als content gespeichert (der Agent liest ihn). Gibt den VFS-Pfad zurück.
 */
export async function uploadDocument(caseFolder: string, file: File): Promise<string> {
	const { text, mime } = await extractText(file);
	const dot = file.name.lastIndexOf(".");
	const slug = slugify(dot > 0 ? file.name.slice(0, dot) : file.name);
	const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
	const target = await uniquePath(caseFolder, slug, ext);
	await vfs.writeFile(target, text, "/", { mime, blob: file });
	return target;
}
