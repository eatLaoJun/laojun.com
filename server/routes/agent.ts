import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RoomStudioRepository } from "../db/repository.ts";
import { runPiAgentChat } from "../agent/runtime.ts";
import { createRoomStudioTools, validateCommitRoomDraftGuard } from "../agent/tools.ts";

export function createAgentRoutes(repo: RoomStudioRepository): Hono {
	const app = new Hono();

	app.post("/agent/chat", async (c) => {
		const body = await c.req.json<{
			sessionId?: string;
			roomId?: string;
			message?: string;
			explicitConfirm?: boolean;
		}>().catch(() => ({} as { sessionId?: string; roomId?: string; message?: string; explicitConfirm?: boolean }));

		const sessionId = body.sessionId || "public-default";
		const message = body.message?.trim();
		if (!message) {
			return c.json({ error: "消息内容不能为空。" }, 400);
		}
		if (body.roomId && repo.getRoom(body.roomId)) {
			repo.updateSessionActiveRoom(sessionId, body.roomId);
		}

		return streamSSE(c, async (stream) => {
			const abortController = new AbortController();
			stream.onAbort(() => abortController.abort());

			let writeChain = Promise.resolve();
			await runPiAgentChat({
				repo,
				sessionId,
				userMessage: message,
				explicitConfirm: Boolean(body.explicitConfirm),
				signal: abortController.signal,
				emit: (event) => {
					writeChain = writeChain
						.then(() => stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
						}))
						.catch(() => {});
				},
			});
			await writeChain;
		});
	});

	app.post("/agent/draft/confirm", async (c) => {
		const body = await c.req.json<{ sessionId?: string; populateStarterFurniture?: boolean }>().catch(() => ({} as { sessionId?: string; populateStarterFurniture?: boolean }));
		const sessionId = body.sessionId || "public-default";
		const guard = validateCommitRoomDraftGuard(repo, sessionId, "确认创建", true);
		if (guard.block) {
			return c.json({ error: guard.reason }, 400);
		}
		const tools = createRoomStudioTools(repo, sessionId);
		const commitTool = tools.find((t) => t.name === "commit_room_draft")!;
		await commitTool.execute("ui-confirm", { populateStarterFurniture: body.populateStarterFurniture ?? true }, new AbortController().signal);
		const snapshot = repo.getStudioSnapshot(sessionId);
		return c.json({ snapshot });
	});

	app.delete("/agent/draft", (c) => {
		const sessionId = c.req.query("sessionId") || "public-default";
		repo.saveSessionDraft(sessionId, null);
		return c.json({ ok: true, draft: null });
	});

	app.delete("/agent/messages", (c) => {
		const sessionId = c.req.query("sessionId") || "public-default";
		repo.saveSessionMessages(sessionId, []);
		return c.json({ ok: true });
	});

	return app;
}
