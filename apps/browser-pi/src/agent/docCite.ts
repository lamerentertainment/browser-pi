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

/** Formuliert die vorbefüllte Chat-Eingabe; der Nutzer tippt seinen Auftrag dahinter. */
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
