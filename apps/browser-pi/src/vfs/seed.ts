// Kuratierte, NICHT-sensitive Grundausstattung (Seed/Defaults).
// Wird beim ersten Start einmalig in die lokale IndexedDB gespiegelt; danach
// bearbeitet der Nutzer nur seine lokale Kopie (CLAUDE.md, Prinzip 2).
// Dokumente/Fälle sind NIE Teil des Seeds — immer rein lokal.

import { idb } from "./idb.ts";
import { vfs } from "./vfs.ts";

const SEED_MARKER = "/.seeded";

interface SeedFile {
	path: string;
	content: string;
}

const SEED_FILES: SeedFile[] = [
	{
		path: "/prompts/anonymisierung.md",
		content: `# Prompt: Dokument anonymisieren

Du anonymisierst das übergebene Dokument. Ersetze Personennamen, Adressen,
Geburtsdaten und weitere identifizierende Merkmale durch konsistente
Platzhalter (z.B. [PERSON_1], [ADRESSE_1]). Halte die Zuordnung über das
gesamte Dokument konsistent.
`,
	},
	{
		path: "/prompts/zusammenfassung.md",
		content: `# Prompt: Zusammenfassung

Fasse das Dokument in maximal 10 Sätzen zusammen. Nenne die wichtigsten
Parteien, den Streitgegenstand und das Ergebnis.
`,
	},
	{
		path: "/textblocks/rechtsbelehrung.md",
		content: `Gegen diesen Entscheid kann innert 30 Tagen seit Eröffnung beim zuständigen
Gericht schriftlich Beschwerde erhoben werden. Die Beschwerde hat die Begehren,
deren Begründung mit Angabe der Beweismittel und die Unterschrift zu enthalten.
`,
	},
	{
		path: "/textblocks/disclaimer.md",
		content: `Dieses Dokument wurde mit Unterstützung eines KI-Agenten erstellt und ist vor
Verwendung durch eine fachkundige Person zu prüfen.
`,
	},
	{
		path: "/cases/README.md",
		content: `# Fälle

Lege pro Fall ein Verzeichnis an, z.B. /cases/2026-001/.
Dokumente, Versionen und Notizen eines Falls bleiben rein lokal in diesem
Browser (IndexedDB) und verlassen ihn nie.
`,
	},
	{
		path: "/cases/2026-001/sachverhalt.md",
		content: `# Fall 2026-001 — Sachverhalt

Beispielfall. Hier landen die Dokumente eines konkreten Falls.

Die Klägerin Anna Muster (geb. 1.1.1980, wohnhaft Musterstrasse 1, 8000 Zürich)
verlangt vom Beklagten Max Beispiel die Rückzahlung eines Darlehens von
CHF 10'000.
`,
	},
];

/** Spiegelt die Seed-Dateien einmalig in die lokale IndexedDB. */
export async function seedIfNeeded(): Promise<boolean> {
	const marker = await idb.get(SEED_MARKER);
	if (marker) return false;
	for (const file of SEED_FILES) {
		// Nur anlegen, wenn der Nutzer die Datei nicht schon hat.
		if (!(await vfs.exists(file.path))) {
			await vfs.writeFile(file.path, file.content);
		}
	}
	await idb.put({ path: SEED_MARKER, content: "1", mtime: Date.now() });
	return true;
}
