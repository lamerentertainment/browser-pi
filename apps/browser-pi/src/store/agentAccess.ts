// Steuert, auf welche Case-Ordner der Agent Zugriff hat.
// Gesperrte Fälle sind für den Agenten unsichtbar (kein ls, cat, find, grep).
// Zustand wird in localStorage persistiert.

import { reactive, watchEffect } from "vue";
import { normalizePath } from "../vfs/vfs.ts";

const STORAGE_KEY = "browser-pi.agent-access.blocked";

function load(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as string[];
	} catch {}
	return [];
}

/** Menge der gesperrten Case-Ordner-Pfade (z.B. "/cases/mein-fall"). */
export const blockedCasePaths = reactive(new Set<string>(load()));

watchEffect(() => {
	localStorage.setItem(STORAGE_KEY, JSON.stringify([...blockedCasePaths]));
});

/** Gibt true zurück wenn der Pfad zu einem gesperrten Fall gehört. */
export function isPathBlocked(path: string, cwd = "/"): boolean {
	let norm: string;
	try {
		norm = normalizePath(path, cwd);
	} catch {
		return false;
	}
	for (const blocked of blockedCasePaths) {
		if (norm === blocked || norm.startsWith(`${blocked}/`)) return true;
	}
	return false;
}

export function isCaseBlocked(caseFolder: string): boolean {
	return blockedCasePaths.has(caseFolder);
}

export function toggleCaseAccess(caseFolder: string): void {
	if (blockedCasePaths.has(caseFolder)) {
		blockedCasePaths.delete(caseFolder);
	} else {
		blockedCasePaths.add(caseFolder);
	}
}
