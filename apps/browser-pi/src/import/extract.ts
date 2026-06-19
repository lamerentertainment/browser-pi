// Dokument-Extraktion — wandelt hochgeladene Dateien (PDF/DOCX/TXT) in
// agent-lesbaren Klartext. Läuft vollständig clientseitig: keine Bytes verlassen
// den Browser (CLAUDE.md, Lokal-only/Privacy-Invariante).
//
// Die PDF-Logik (reconstructPageText) stammt aus iusable_anonymization: sie
// rekonstruiert aus den pdf.js-Positionsdaten lesbaren Fliesstext, statt die
// rohen, oft zerhackten Text-Fragmente aneinanderzureihen.

import mammoth from "mammoth";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
// Worker gebündelt ausliefern (Vite ?url) — echt offline, kein CDN-Fallback.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractResult {
	/** Extrahierter Klartext (agent-lesbar). */
	text: string;
	/** MIME-Typ des Originals. */
	mime: string;
}

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

/** Prüft anhand der Endung, ob eine Datei unterstützt wird. */
export function isSupported(name: string): boolean {
	const lower = name.toLowerCase();
	return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Seitengrenzen werden für den Agenten explizit markiert, statt im Fliesstext
 * unterzugehen. Eine eigene, deutlich abgesetzte Zeile, damit der Agent sie als
 * Meta-Information referenzieren ("auf Seite 3 steht …") und nicht als
 * Dokumentinhalt missverstehen kann.
 */
export function pageMarker(n: number): string {
	return `--- Seite ${n} ---`;
}

/** Extrahiert Klartext aus einer hochgeladenen Datei. */
export async function extractText(file: File): Promise<ExtractResult> {
	const name = file.name.toLowerCase();
	if (name.endsWith(".pdf")) {
		return { text: await extractPdf(file), mime: "application/pdf" };
	}
	if (name.endsWith(".docx")) {
		return {
			text: await extractDocx(file),
			mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		};
	}
	if (name.endsWith(".txt")) {
		return { text: await file.text(), mime: "text/plain" };
	}
	throw new Error(`Nicht unterstütztes Dateiformat: ${file.name}`);
}

async function extractPdf(file: File): Promise<string> {
	const data = new Uint8Array(await file.arrayBuffer());
	const pdf = await getDocument({ data }).promise;
	const pages: string[] = [];
	for (let i = 1; i <= pdf.numPages; i++) {
		const page = await pdf.getPage(i);
		const textContent = await page.getTextContent();
		const items = textContent.items.filter((it): it is TextItem => "str" in it);
		// PDF hat echte, feste Seiten: jede Grenze ist bekannt, also wird jede
		// Seite (auch die erste) markiert — der Agent bekommt ein vollständiges
		// Seiten-Koordinatensystem.
		pages.push(`${pageMarker(i)}\n\n${reconstructPageText(items)}`);
	}
	return pages.join("\n\n").trim();
}

/**
 * DOCX kennt — anders als PDF — KEINE festen Seiten: die Paginierung entsteht
 * erst beim Rendern (Schriftart, Seitengrösse). Zuverlässig bekannt sind nur
 * MANUELLE Seitenumbrüche (`<w:br w:type="page"/>`); automatische, layoutbedingte
 * Umbrüche existieren in der Datei gar nicht und werden hier bewusst nicht geraten.
 *
 * `extractRawText` verwirft auch die manuellen Umbrüche. Deshalb über die
 * öffentliche `convertToHtml`-API gehen und Seitenumbrüche per StyleMap auf `<hr>`
 * mappen, dann das HTML zu Klartext wandeln und an den `<hr>` Seitenmarker setzen.
 */
async function extractDocx(file: File): Promise<string> {
	const arrayBuffer = await file.arrayBuffer();
	const { value: html } = await mammoth.convertToHtml(
		{ arrayBuffer },
		{ styleMap: ["br[type='page'] => hr"] },
	);
	return htmlToText(html);
}

/**
 * Wandelt mammoth-HTML in Klartext. Blockelemente erzeugen Zeilenumbrüche,
 * `<hr>` (= manueller Seitenumbruch) setzt einen Seitenmarker. Die Nummerierung
 * startet bei 1 und zählt pro Umbruch hoch; der ERSTE Marker ist also „Seite 2".
 * Ein DOCX ohne manuelle Umbrüche bleibt damit markerfrei — es wird keine
 * Seitenstruktur vorgetäuscht, die das Dokument nicht hat.
 */
function htmlToText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	let out = "";
	let page = 1;

	const walk = (node: Node): void => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				out += child.textContent ?? "";
				continue;
			}
			if (child.nodeType !== Node.ELEMENT_NODE) continue;
			const el = child as Element;
			switch (el.tagName) {
				case "HR":
					page += 1;
					out = `${out.replace(/[ \t\n]+$/, "")}\n\n${pageMarker(page)}\n\n`;
					break;
				case "BR":
					out += "\n";
					break;
				case "LI":
					out += "- ";
					walk(el);
					out += "\n";
					break;
				case "TD":
				case "TH":
					walk(el);
					out += "\t";
					break;
				case "P":
				case "H1":
				case "H2":
				case "H3":
				case "H4":
				case "H5":
				case "H6":
				case "TR":
				case "BLOCKQUOTE":
					walk(el);
					out += "\n\n";
					break;
				default:
					walk(el);
			}
		}
	};
	walk(doc.body);

	// Whitespace normalisieren: Zeilen rechts trimmen, höchstens eine Leerzeile.
	return out
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

interface Box {
	str: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Rekonstruiert lesbaren Text aus pdf.js-TextItems anhand ihrer Position.
 * Übernommen aus iusable_anonymization (Anon.vue, reconstructPageText): Zeilen
 * werden über eine medianhöhen-basierte Toleranz gruppiert, Wort-/Spalten-
 * abstände aus den Lücken rekonstruiert.
 */
function reconstructPageText(items: TextItem[]): string {
	// Positionsdaten aus der pdf.js-transform-Matrix [a,b,c,d,x,y].
	const boxes: Box[] = items
		.filter((item) => item.str && item.str.length > 0)
		.map((item) => {
			const x = item.transform[4];
			const y = item.transform[5];
			return { str: item.str, x, y, w: item.width, h: Math.abs(item.height) || 12 };
		});

	if (boxes.length === 0) return "";

	// Medianhöhe → Toleranz für die Zeilen-Gruppierung.
	const sortedH = boxes.map((b) => b.h).sort((a, b) => a - b);
	const medianH = sortedH[Math.floor(sortedH.length / 2)] || 12;
	const yTolerance = Math.max(medianH * 0.5, 5);

	// Mittlere Zeichenbreite für die Lücken-Klassifikation.
	const avgCharW =
		boxes.reduce((sum, b) => sum + (b.str.length > 0 ? b.w / b.str.length : 0), 0) /
			boxes.length || 7;

	// Sortieren: Y absteigend (PDF-Ursprung unten links), dann X aufsteigend.
	boxes.sort((a, b) => {
		const dy = b.y - a.y;
		if (Math.abs(dy) > yTolerance) return dy;
		return a.x - b.x;
	});

	// In Zeilen gruppieren (Y-Nähe).
	const lines: { y: number; items: Box[] }[] = [];
	for (const box of boxes) {
		const last = lines[lines.length - 1];
		if (last && Math.abs(box.y - last.y) <= yTolerance) {
			last.items.push(box);
		} else {
			lines.push({ y: box.y, items: [box] });
		}
	}

	// Jede Zeile mit lückenbasierten Abständen rendern.
	const rendered = lines.map((line) => {
		const sorted = line.items.sort((a, b) => a.x - b.x);
		let text = "";
		let prevRight: number | null = null;
		for (const item of sorted) {
			if (prevRight === null) {
				text += item.str;
			} else {
				const gap = item.x - prevRight;
				if (gap >= avgCharW * 4) {
					// Grosse Lücke → Spaltentrenner.
					text += `    ${item.str}`;
				} else if (gap >= avgCharW * 0.3) {
					// Wort-Lücke → einzelnes Leerzeichen.
					if (!text.endsWith(" ") && !item.str.startsWith(" ")) text += " ";
					text += item.str;
				} else {
					// Winzige Lücke oder Überlappung → direkt anhängen.
					text += item.str;
				}
			}
			prevRight = item.x + item.w;
		}
		return text.trimEnd();
	});

	// Leerzeilen für grosse vertikale Lücken zwischen Zeilen einfügen.
	const result: string[] = [];
	for (let i = 0; i < rendered.length; i++) {
		result.push(rendered[i]);
		if (i < lines.length - 1) {
			const vertGap = lines[i].y - lines[i + 1].y;
			const blanks = Math.min(Math.round(vertGap / medianH) - 1, 3);
			for (let j = 0; j < blanks; j++) result.push("");
		}
	}

	return result.join("\n");
}
