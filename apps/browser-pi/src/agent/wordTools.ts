// Word-Live-Tools — der Agent bearbeitet das aktuell geöffnete Word-Dokument
// direkt im SuperDoc-Editor. JEDE Änderung wird als Tracked Change
// (Überarbeitungsmodus) angewandt: `changeMode: "tracked"`. Der Mensch sieht
// die Vorschläge sofort live im Editor und kann sie annehmen/verwerfen.
//
// Adressiert wird ausschliesslich über Literaltext-Suche (query.match,
// mode: "contains") → daraus ein revisions-stabiler `ref`, den die Mutationen
// (replace/insert/delete) konsumieren. Das hält die Tool-Oberfläche klein und
// für kleine lokale LLMs robust.

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "@earendil-works/pi-ai";
import type { DocumentApi } from "@harbour-enterprises/superdoc";
import { getActiveWordDoc } from "./wordBridge.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: undefined };
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const bool = (v: unknown): boolean => v === true || v === "true";

// Tracked Changes: Agentenänderungen erscheinen IMMER im Überarbeitungsmodus.
const TRACKED = { changeMode: "tracked" as const };

// Obergrenze für „alle ersetzen" — verhindert Endlosschleifen, falls der neue
// Text das Suchmuster erneut enthält.
const MAX_REPLACEMENTS = 500;

/**
 * Holt die DocumentApi des aktuell offenen Word-Dokuments oder eine
 * Fehlermeldung, wenn keines offen ist bzw. der Editor noch lädt.
 */
function activeDoc(): { doc: DocumentApi } | { error: string } {
	const active = getActiveWordDoc();
	if (!active) {
		return {
			error:
				"Kein Word-Dokument geöffnet. Diese Tools wirken nur auf das gerade " +
				"im Editor angedockte .docx. Bitte zuerst ein Word-Dokument öffnen.",
		};
	}
	try {
		return { doc: active.doc() };
	} catch {
		return { error: "Der Word-Editor lädt noch — bitte gleich erneut versuchen." };
	}
}

/** Sucht das erste Vorkommen von `pattern` und liefert dessen Mutations-ref. */
function firstRef(doc: DocumentApi, pattern: string): string | null {
	const res = doc.query.match({
		select: { type: "text", pattern, mode: "contains" },
		limit: 1,
	});
	return res.items[0]?.handle.ref ?? null;
}

const FindSchema = Type.Object({
	text: Type.String({ description: "Der zu suchende Textausschnitt (wörtlich)" }),
});
const ReplaceSchema = Type.Object({
	suchen: Type.String({ description: "Zu ersetzender Text (wörtlich)" }),
	ersetzen: Type.String({ description: "Neuer Text" }),
	alle: Type.String({
		description: "'true' = alle Vorkommen ersetzen, 'false' = nur das erste",
	}),
});
const InsertSchema = Type.Object({
	text: Type.String({ description: "Einzufügender Text (Markdown erlaubt beim Anhängen)" }),
	nach: Type.String({
		description:
			"Wörtlicher Ankertext, NACH dem eingefügt wird. Leer lassen ('') zum " +
			"Anhängen am Dokumentende.",
	}),
});
const DeleteSchema = Type.Object({
	text: Type.String({ description: "Zu löschender Text (wörtlich)" }),
});

/**
 * Baut die Live-Word-Tools. Sie greifen zur Ausführungszeit auf das gerade
 * offene Dokument zu (siehe wordBridge) — die Liste kann einmalig beim
 * Session-Aufbau erstellt werden.
 */
export function createWordTools(): AgentTool<TSchema>[] {
	const wordRead: AgentTool = {
		name: "word_read",
		label: "Word lesen",
		description:
			"Liest den vollständigen Inhalt des aktuell geöffneten Word-Dokuments als " +
			"Markdown (mit Überschriften/Listen). Nutze das, um vor Änderungen den " +
			"echten, aktuellen Editor-Stand zu sehen.",
		parameters: Type.Object({}),
		execute: async () => {
			const a = activeDoc();
			if ("error" in a) return text(a.error);
			const md = a.doc.getMarkdown({});
			return text(md.trim() ? md : "(Dokument ist leer)");
		},
	};

	const wordFind: AgentTool = {
		name: "word_find",
		label: "Word durchsuchen",
		description:
			"Sucht wörtlichen Text im geöffneten Word-Dokument und meldet die Anzahl " +
			"Treffer. Dient zum Prüfen, ob ein Ankertext für replace/insert/delete existiert.",
		parameters: FindSchema,
		execute: async (_id, params) => {
			const a = activeDoc();
			if ("error" in a) return text(a.error);
			const pattern = str(params.text);
			const res = a.doc.query.match({
				select: { type: "text", pattern, mode: "contains" },
			});
			return text(
				res.total > 0
					? `${res.total} Treffer für „${pattern}".`
					: `Kein Treffer für „${pattern}".`,
			);
		},
	};

	const wordReplace: AgentTool = {
		name: "word_replace",
		label: "Word ersetzen",
		description:
			"Ersetzt im geöffneten Word-Dokument wörtlichen Text durch neuen Text. " +
			"Die Änderung erscheint als Überarbeitung (Track Changes) — der Mensch " +
			"kann sie annehmen oder verwerfen.",
		parameters: ReplaceSchema,
		execute: async (_id, params) => {
			const a = activeDoc();
			if ("error" in a) return text(a.error);
			const suchen = str(params.suchen);
			const ersetzen = str(params.ersetzen);
			if (!suchen) return text("Fehler: 'suchen' darf nicht leer sein.");
			// Enthält der neue Text das Suchmuster, würde „alle" die Einfügung
			// endlos neu finden — dann nur einmal ersetzen.
			const selfContaining = ersetzen.toLowerCase().includes(suchen.toLowerCase());
			const alle = bool(params.alle) && !selfContaining;

			let count = 0;
			while (count < MAX_REPLACEMENTS) {
				const ref = firstRef(a.doc, suchen);
				if (!ref) break;
				const r = a.doc.replace({ ref, text: ersetzen }, TRACKED);
				if (!r.success) {
					return text(`Fehler beim Ersetzen: ${r.failure?.message ?? "unbekannt"}`);
				}
				count++;
				if (!alle) break;
			}
			if (count === 0) return text(`Kein Treffer für „${suchen}" — nichts ersetzt.`);
			return text(
				`${count} Vorkommen als Überarbeitung ersetzt (im Editor sichtbar).`,
			);
		},
	};

	const wordInsert: AgentTool = {
		name: "word_insert",
		label: "Word einfügen",
		description:
			"Fügt Text in das geöffnete Word-Dokument ein — am Ende (Markdown erlaubt) " +
			"oder nach einem wörtlichen Ankertext (Parameter 'nach'). Die Einfügung " +
			"erscheint als Überarbeitung (Track Changes).",
		parameters: InsertSchema,
		execute: async (_id, params) => {
			const a = activeDoc();
			if ("error" in a) return text(a.error);
			const content = str(params.text);
			const nach = str(params.nach);
			if (!content) return text("Fehler: 'text' darf nicht leer sein.");

			if (nach) {
				const ref = firstRef(a.doc, nach);
				if (!ref) return text(`Ankertext „${nach}" nicht gefunden — nichts eingefügt.`);
				const r = a.doc.insert({ ref, value: content, type: "text" }, TRACKED);
				if (!r.success) {
					return text(`Fehler beim Einfügen: ${r.failure?.message ?? "unbekannt"}`);
				}
				return text("Text als Überarbeitung nach dem Anker eingefügt.");
			}

			const r = a.doc.insert({ value: content, type: "markdown" }, TRACKED);
			if (!r.success) {
				return text(`Fehler beim Einfügen: ${r.failure?.message ?? "unbekannt"}`);
			}
			return text("Text als Überarbeitung am Dokumentende angehängt.");
		},
	};

	const wordDelete: AgentTool = {
		name: "word_delete",
		label: "Word löschen",
		description:
			"Löscht wörtlichen Text aus dem geöffneten Word-Dokument. Die Löschung " +
			"erscheint als Überarbeitung (Track Changes) — durchgestrichen, bis sie " +
			"angenommen wird.",
		parameters: DeleteSchema,
		execute: async (_id, params) => {
			const a = activeDoc();
			if ("error" in a) return text(a.error);
			const target = str(params.text);
			if (!target) return text("Fehler: 'text' darf nicht leer sein.");
			const ref = firstRef(a.doc, target);
			if (!ref) return text(`Kein Treffer für „${target}" — nichts gelöscht.`);
			const r = a.doc.delete({ ref }, TRACKED);
			if (!r.success) {
				return text(`Fehler beim Löschen: ${r.failure?.message ?? "unbekannt"}`);
			}
			return text("Text als Überarbeitung zur Löschung markiert (durchgestrichen).");
		},
	};

	return [wordRead, wordFind, wordReplace, wordInsert, wordDelete] as unknown as AgentTool<TSchema>[];
}
