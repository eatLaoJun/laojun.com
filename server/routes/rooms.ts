import { Hono } from "hono";
import type { LayoutStyle, RoomItem } from "../../src/room/core/model.ts";
import type { RoomStudioRepository } from "../db/repository.ts";

export function createRoomRoutes(repo: RoomStudioRepository): Hono {
	const app = new Hono();

	app.get("/rooms", (c) => {
		const sessionId = c.req.query("sessionId") || "public-default";
		const roomId = c.req.query("roomId");
		const session = repo.getOrCreateSession(sessionId);
		const snapshot = repo.getStudioSnapshot(sessionId, roomId || undefined);
		return c.json({ snapshot, messages: session.messages });
	});

	app.post("/rooms/:id/activate", (c) => {
		const sessionId = c.req.query("sessionId") || "public-default";
		const roomId = c.req.param("id");
		try {
			repo.updateSessionActiveRoom(sessionId, roomId);
			return c.json({ snapshot: repo.getStudioSnapshot(sessionId, roomId) });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
		}
	});

	app.put("/rooms/:id/layout", async (c) => {
		const roomId = c.req.param("id");
		const body = await c.req.json<{ items?: RoomItem[] }>().catch(() => ({ items: undefined }));
		if (!Array.isArray(body.items)) {
			return c.json({ error: "缺少有效的 items 数组。" }, 400);
		}
		try {
			const room = repo.updateRoomLayout(roomId, body.items);
			return c.json({ room });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}
	});

	app.post("/rooms/:id/variants", async (c) => {
		const roomId = c.req.param("id");
		const body = await c.req.json<{ name?: string; items?: RoomItem[]; style?: LayoutStyle | "custom" }>().catch(() => ({} as { name?: string; items?: RoomItem[]; style?: LayoutStyle | "custom" }));
		const room = repo.getRoom(roomId);
		if (!room) return c.json({ error: "房间不存在。" }, 404);
		const name = body.name?.trim() || `方案-${repo.listVariants(roomId).length + 1}`;
		const items = Array.isArray(body.items) ? body.items : room.items;
		const variant = repo.saveVariant(roomId, name, items, body.style ?? "custom");
		return c.json({ variant, variants: repo.listVariants(roomId) });
	});

	app.delete("/rooms/:id/variants/:vid", (c) => {
		const roomId = c.req.param("id");
		const vid = c.req.param("vid");
		repo.deleteVariant(vid);
		return c.json({ variants: repo.listVariants(roomId) });
	});

	app.post("/rooms/:id/variants/:vid/apply", (c) => {
		const sessionId = c.req.query("sessionId") || "public-default";
		const roomId = c.req.param("id");
		const vid = c.req.param("vid");
		try {
			repo.applyVariant(roomId, vid);
			return c.json({ snapshot: repo.getStudioSnapshot(sessionId, roomId) });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
		}
	});

	return app;
}
