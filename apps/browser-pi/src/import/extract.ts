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

/** Extrahiert Klartext aus einer hochgeladenen Datei. */
export async function extractText(file: File): Promise<ExtractResult> {
	const name = file.name.toLowerCase();
	if (name.endsWith(".pdf")) {
		return { text: await extractPdf(file), mime: "application/pdf" };
	}
	if (name.endsWith(".docx")) {
		const arrayBuffer = await file.arrayBuffer();
		const result = await mammoth.extractRawText({ arrayBuffer });
		return {
			text: result.value,
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
		pages.push(reconstructPageText(items));
	}
	return pages.join("\n\n").trim();
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
