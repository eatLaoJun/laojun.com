import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.ts";
import { openStudioDatabase } from "./db/sqlite.ts";
import { RoomStudioRepository } from "./db/repository.ts";
import { createRoomRoutes } from "./routes/rooms.ts";
import { createAgentRoutes } from "./routes/agent.ts";

export function createStudioServer(dbPath = env.dbPath) {
	const db = openStudioDatabase(dbPath);
	const repo = new RoomStudioRepository(db);
	const app = new Hono();

	app.use("/api/*", cors());

	app.get("/api/health", (c) => {
		return c.json({
			ok: true,
			llmConfigured: Boolean(env.llmApiKey),
			provider: env.llmProvider,
			model: env.llmModel,
		});
	});

	app.route("/api", createRoomRoutes(repo));
	app.route("/api", createAgentRoutes(repo));

	return { app, db, repo };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("server/index.ts");
if (isMain) {
	const { app } = createStudioServer();
	serve({ fetch: app.fetch, port: env.port }, (info) => {
		console.log(`[Room Studio Server] listening on http://localhost:${info.port}`);
		console.log(`[Room Studio Server] SQLite DB: ${env.dbPath}`);
		console.log(`[Room Studio Server] PiAgent LLM: ${env.llmApiKey ? `${env.llmProvider}/${env.llmModel}` : "本地演示模式（配置 .env LLM_API_KEY 启用大模型）"}`);
	});
}
