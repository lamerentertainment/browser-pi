// Slash-Commands und Prompt-Bibliothek für die Eingabezeile.
// Built-in Commands steuern Sitzung und UI; Prompt-Einträge werden per Slash
// aus der Bibliothek eingefügt (CLAUDE.md, "Zielgruppe & Bedienkonzept").

export type SlashCommandName =
	| "neu"
	| "leeren"
	| "einstellungen"
	| "export"
	| "hilfe";

export interface SlashCommand {
	name: SlashCommandName;
	description: string;
}

/** Ein gespeicherter Prompt aus der Bibliothek, abrufbar per Slash-Command. */
export interface PromptEntry {
	kind: "prompt";
	title: string;
	/** VFS-Pfad zur Prompt-Datei. */
	path: string;
}

/** Eintrag in der Autovervollständigungs-Palette: eingebaut oder Prompt. */
export type PaletteEntry =
	| { kind: "command"; name: SlashCommandName; description: string }
	| PromptEntry;

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{ name: "neu", description: "Neue Sitzung beginnen (Verlauf verwerfen)" },
	{ name: "leeren", description: "Terminal leeren (Verlauf ausblenden)" },
	{ name: "einstellungen", description: "Einstellungen öffnen" },
	{ name: "export", description: "Gesprächsverlauf als Textdatei speichern" },
	{ name: "hilfe", description: "Verfügbare Befehle anzeigen" },
];

/** Beginnt die Eingabe mit '/'? Nur dann ist sie (potenziell) ein Befehl. */
export function isSlashInput(input: string): boolean {
	return input.startsWith("/");
}

/**
 * Liefert alle passenden Palette-Einträge (built-in Commands + Prompts).
 * - `null` wenn kein '/'-Präfix oder bereits ein Leerzeichen folgt.
 * - Built-in Commands zuerst, danach gefilterte Prompt-Einträge.
 */
export function matchPaletteEntries(
	input: string,
	prompts: PromptEntry[],
): PaletteEntry[] | null {
	if (!isSlashInput(input)) return null;
	if (/\s/.test(input)) return null;
	const query = input.slice(1).toLowerCase();
	const cmds: PaletteEntry[] = SLASH_COMMANDS
		.filter(
			(c) =>
				c.name.startsWith(query) ||
				c.description.toLowerCase().includes(query),
		)
		.map((c) => ({ kind: "command" as const, name: c.name, description: c.description }));
	const ps: PaletteEntry[] = prompts.filter((p) =>
		query === "" || p.title.toLowerCase().includes(query),
	);
	return [...cmds, ...ps];
}

/** @deprecated Verwende matchPaletteEntries. Nur noch intern genutzt. */
export function matchSlashCommands(input: string): SlashCommand[] | null {
	if (!isSlashInput(input)) return null;
	if (/\s/.test(input)) return null;
	const query = input.slice(1).toLowerCase();
	return SLASH_COMMANDS.filter(
		(c) =>
			c.name.startsWith(query) ||
			c.description.toLowerCase().includes(query),
	);
}

/**
 * Löst eine vollständige Eingabe beim Absenden in einen Befehl auf.
 * Rückgabe:
 *  - `null`            → kein Slash-Befehl (normale Agenten-Aufgabe)
 *  - `SlashCommand`    → erkannter Befehl
 *  - `{ unknown }`     → '/x' ohne passenden Befehl
 */
export function resolveSlashCommand(
	input: string,
): SlashCommand | { unknown: string } | null {
	const trimmed = input.trim();
	if (!isSlashInput(trimmed)) return null;
	const name = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
	const cmd = SLASH_COMMANDS.find((c) => c.name === name);
	return cmd ?? { unknown: name };
}
