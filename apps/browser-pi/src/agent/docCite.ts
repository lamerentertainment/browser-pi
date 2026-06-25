// Bezugsstelle aus dem Word-Editor → vorbefüllte Chat-Eingabe für den Agenten.
//
// Der Nutzer markiert per Rechtsklick eine Stelle im Dokument; daraus wird ein
// wörtlicher Anker, den die Word-Tools (wordTools.ts) wiederfinden. Eine LEERE
// Zeile hat keinen eigenen Text — sie wird deshalb als Einfügeposition relativ
// zum nächsten nicht-leeren Nachbar-Absatz beschrieben (Richtung danach/davor),
// was sich direkt auf `word_insert { nach }` abbildet.

export type CiteAnchor =
	/** Auswahl oder nicht-leerer Absatz: direkt am Text ankerbar. */
	| { kind: "text"; text: string }
	/** Leerzeile, davor steht Text → hier einfügen NACH diesem Absatz. */
	| { kind: "after"; text: string }
	/** Leerzeile am Dokumentanfang → einfügen VOR diesem Absatz. */
	| { kind: "before"; text: string }
	/** Dokument hat überhaupt keinen Text. */
	| { kind: "empty" };

/**
 * Kompaktes, kleingeschriebenes Badge-Label für die Eingabezeile und das
 * Terminal-Echo — die menschliche Kurzform der Bezugsstelle (der Agent bekommt
 * stattdessen den vollen citePrompt-Text).
 */
export function citeBadge(a: CiteAnchor): string {
	const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
	switch (a.kind) {
		case "text":
			return `stelle: ${clip(a.text)}`;
		case "after":
			return `nach: ${clip(a.text)}`;
		case "before":
			return `vor: ${clip(a.text)}`;
		case "empty":
			return "dokumentanfang";
	}
}

/** Voller Vorspann, der dem Agenten vorangestellt wird (er adressiert über den Wortlaut). */
export function citePrompt(a: CiteAnchor): string {
	switch (a.kind) {
		case "text":
			return `Bezug auf folgende Stelle im Dokument: „${a.text}“ — `;
		case "after":
			return `Bezug auf die leere Zeile direkt nach „${a.text}“ — dort einfügen: `;
		case "before":
			return `Bezug auf die leere Zeile direkt vor „${a.text}“ — dort einfügen: `;
		case "empty":
			return "Das Dokument ist leer — schreibe an den Anfang: ";
	}
}
