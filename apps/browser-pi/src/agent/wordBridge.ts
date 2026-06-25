// Word-Bridge — verbindet den LIVE im UI gemounteten SuperDoc-Editor mit den
// Agenten-Tools (wordTools.ts).
//
// Hintergrund: Die normalen Datei-Tools (read/write/edit) arbeiten auf dem
// EXTRAHIERTEN Text eines Dokuments im VFS (IndexedDB) — sie sehen den lebenden
// SuperDoc-Editor nicht. Für „der Agent bearbeitet ein Word live" brauchen wir
// einen Draht von der Vue-Komponente (DocumentPanel/SuperDocEditor) zur
// Tool-Schicht, ohne die Komponenten direkt zu koppeln.
//
// Genau ein Word-Dokument kann zugleich angedockt/offen sein, also genügt ein
// Singleton-Slot. Die Komponente registriert sich beim Mounten und meldet sich
// beim Schliessen wieder ab; die Tools greifen zur Ausführungszeit (lazy) auf
// die agentenfreundliche DocumentApi des aktiven Editors zu.
//
// SICHERHEIT/Lokal-only-Invariante bleibt gewahrt: hier fliesst nichts ins Netz
// oder ans Host-FS. Die Bridge hält nur eine In-Memory-Referenz auf den bereits
// im Browser laufenden Editor.

import type { DocumentApi } from "@harbour-enterprises/superdoc";

export interface ActiveWordDoc {
	/** VFS-Pfad des offenen Dokuments (für Tool-Rückmeldungen/System-Prompt). */
	path: string;
	/** Anzeigename (Dateiname) des offenen Dokuments. */
	title: string;
	/**
	 * Liefert die agentenfreundliche DocumentApi des aktiven Editors (live).
	 * Wirft, wenn der Editor noch lädt — die Tools fangen das ab.
	 */
	doc(): DocumentApi;
}

let active: ActiveWordDoc | null = null;
const listeners = new Set<(d: ActiveWordDoc | null) => void>();

/** Registriert (oder ersetzt) das aktuell offene Word-Dokument. */
export function setActiveWordDoc(d: ActiveWordDoc | null): void {
	active = d;
	for (const fn of listeners) fn(active);
}

/** Hebt die Registrierung auf, wenn genau dieses Dokument noch aktiv ist. */
export function clearActiveWordDoc(path: string): void {
	if (active?.path === path) setActiveWordDoc(null);
}

/** Das aktuell offene Word-Dokument oder null. */
export function getActiveWordDoc(): ActiveWordDoc | null {
	return active;
}

/** Abonniert Wechsel des aktiven Dokuments (UI/Status). Liefert ein Abmelde-Callback. */
export function onActiveWordDocChange(
	fn: (d: ActiveWordDoc | null) => void,
): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
