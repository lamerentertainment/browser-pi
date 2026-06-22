// Dev-only seed — lädt echte Test-PDFs (mit Blob) in den Fall «Schröder».
// Läuft nur im Vite-Dev-Modus; in Production ist diese Datei ein No-op.
// PDFs liegen unter public/test-fixtures/ und werden per fetch() geladen.

import { extractText } from "../import/extract.ts";
import { slugify } from "../library/library.ts";
import { idb } from "./idb.ts";
import { vfs } from "./vfs.ts";

const DEV_SEED_MARKER = "/.dev-seeded-v1";

interface Fixture {
	/** URL relativ zum Dev-Server (public/-Ordner). */
	url: string;
	/** Dateiname inkl. Endung — wird für Slug + MIME verwendet. */
	filename: string;
	/** Ziel-Ordner im VFS. */
	caseFolder: string;
	/** Vorhandene md-Stub-Datei, die durch das PDF ersetzt wird. */
	replaceMd: string;
}

const FIXTURES: Fixture[] = [
	{
		url: "/test-fixtures/Unterlagen_Haftantrag.pdf",
		filename: "Unterlagen_Haftantrag.pdf",
		caseFolder: "/cases/schroeder",
		replaceMd: "/cases/schroeder/schroeder_unterlagen_haftantrag.md",
	},
	{
		url: "/test-fixtures/Unterlagen_Plaedoyer.pdf",
		filename: "Unterlagen_Plaedoyer.pdf",
		caseFolder: "/cases/schroeder",
		replaceMd: "/cases/schroeder/schroeder_unterlagen_plaedoyer.md",
	},
];

export async function devSeedIfNeeded(): Promise<void> {
	if (!import.meta.env.DEV) return;
	if (await idb.get(DEV_SEED_MARKER)) return;

	for (const fixture of FIXTURES) {
		try {
			const res = await fetch(fixture.url);
			if (!res.ok) {
				console.warn(`[dev-seed] ${fixture.url} → ${res.status}`);
				continue;
			}
			const blob = await res.blob();
			const file = new File([blob], fixture.filename, { type: "application/pdf" });
			const { text, mime } = await extractText(file);

			// md-Stub entfernen, bevor die echte PDF-Datei angelegt wird.
			await vfs.delete(fixture.replaceMd);

			const dot = fixture.filename.lastIndexOf(".");
			const base = dot > 0 ? fixture.filename.slice(0, dot) : fixture.filename;
			const ext = dot > 0 ? fixture.filename.slice(dot).toLowerCase() : "";
			const path = `${fixture.caseFolder}/${slugify(base)}${ext}`;
			await vfs.writeFile(path, text, "/", { mime, blob });
		} catch (err) {
			console.warn(`[dev-seed] Fehler bei ${fixture.filename}:`, err);
		}
	}

	await idb.put({ path: DEV_SEED_MARKER, content: "1", mtime: Date.now() });
}
