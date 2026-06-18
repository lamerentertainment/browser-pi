// Built-in Slash-Commands für die Eingabezeile. Bewusst NUR App-Befehle
// (keine Prompt-Vorlagen): sie steuern Sitzung und UI, nicht den Agenten.
// Anfänger-tauglich: deutsche Namen, jede Zeile mit Klartext-Beschreibung
// (CLAUDE.md, "Zielgruppe & Bedienkonzept").

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
 * Liefert die zur Eingabe passenden Befehle für die Autovervollständigung.
 * - Gibt `null` zurück, wenn die Eingabe kein '/'-Befehl ist (Palette bleibt zu).
 * - Gibt `null` zurück, sobald ein Leerzeichen folgt ("/neu " = fertig getippt).
 * - Filtert nach Präfix des Namens oder Vorkommen in der Beschreibung.
 */
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
