// Endpoint-Konfiguration (nutzerkonfigurierbar, bleibt lokal in localStorage).
import { reactive, watch } from "vue";
import type { LlmConfig } from "../agent/llm.ts";

const STORAGE_KEY = "browser-pi.settings";

const defaults: LlmConfig = {
	// Ollahs OpenAI-kompatibler Endpoint. Bei OpenWebUI z.B. http://localhost:3000/api
	baseUrl: "http://localhost:11434/v1",
	apiKey: "",
	model: "llama3.1",
};

function load(): LlmConfig {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<LlmConfig>) };
	} catch {
		// ignore
	}
	return { ...defaults };
}

export const settings = reactive<LlmConfig>(load());

watch(
	settings,
	(val) => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
	},
	{ deep: true },
);
