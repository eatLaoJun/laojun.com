import fs from "node:fs";
import path from "node:path";

function loadDotEnv(): void {
	const envPath = path.resolve(process.cwd(), ".env");
	if (!fs.existsSync(envPath)) return;
	const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

loadDotEnv();

export const env = {
	port: Number(process.env.PORT || 8787),
	dbPath: process.env.DB_PATH || "./data/room-studio.db",
	llmProvider: process.env.LLM_PROVIDER || "openai",
	llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
	llmApiKey: process.env.LLM_API_KEY || "",
	llmBaseUrl: process.env.LLM_BASE_URL || "",
};
