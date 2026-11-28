import type { DatabaseSync } from "node:sqlite";
import {
	ROOM,
	restoreLayout,
	type LayoutStyle,
	type LayoutVariant,
	type RoomDraft,
	type RoomItem,
	type RoomSpec,
} from "../../src/room/core/model.ts";

export type RoomRecord = {
	id: string;
	name: string;
	spec: RoomSpec;
	items: RoomItem[];
	createdAt: number;
	updatedAt: number;
};

export type StoredChatMessage = {
	role: "user" | "assistant";
	text: string;
	timestamp: number;
};

export type SessionRecord = {
	id: string;
	activeRoomId: string;
	draft: RoomDraft | null;
	messages: StoredChatMessage[];
	updatedAt: number;
};

export type StudioSnapshot = {
	rooms: RoomRecord[];
	activeRoom: RoomRecord;
	variants: LayoutVariant[];
	draft: RoomDraft | null;
};

export class RoomStudioRepository {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	listRooms(): RoomRecord[] {
		const rows = this.db.prepare(
			"SELECT id, name, spec_json, items_json, created_at, updated_at FROM rooms WHERE workspace_id = 'default' ORDER BY created_at ASC",
		).all() as Array<{
			id: string; name: string; spec_json: string; items_json: string; created_at: number; updated_at: number;
		}>;
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			spec: JSON.parse(row.spec_json) as RoomSpec,
			items: JSON.parse(row.items_json) as RoomItem[],
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	getRoom(id: string): RoomRecord | undefined {
		const row = this.db.prepare(
			"SELECT id, name, spec_json, items_json, created_at, updated_at FROM rooms WHERE id = ?",
		).get(id) as {
			id: string; name: string; spec_json: string; items_json: string; created_at: number; updated_at: number;
		} | undefined;
		if (!row) return undefined;
		return {
			id: row.id,
			name: row.name,
			spec: JSON.parse(row.spec_json) as RoomSpec,
			items: JSON.parse(row.items_json) as RoomItem[],
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	createRoom(spec: RoomSpec, items: RoomItem[]): RoomRecord {
		const now = Date.now();
		this.db.prepare(
			"INSERT INTO rooms (id, workspace_id, name, spec_json, items_json, created_at, updated_at) VALUES (?, 'default', ?, ?, ?, ?, ?)",
		).run(spec.id, spec.name, JSON.stringify(spec), JSON.stringify(items), now, now);
		return { id: spec.id, name: spec.name, spec, items, createdAt: now, updatedAt: now };
	}

	updateRoomLayout(roomId: string, items: RoomItem[]): RoomRecord {
		const room = this.getRoom(roomId);
		if (!room) throw new Error(`房间 ${roomId} 不存在。`);
		const validated = restoreLayout(items, room.spec);
		if (!validated) throw new Error("家具布局数据格式无效。");
		const now = Date.now();
		this.db.prepare("UPDATE rooms SET items_json = ?, updated_at = ? WHERE id = ?")
			.run(JSON.stringify(validated), now, roomId);
		return { ...room, items: validated, updatedAt: now };
	}

	listVariants(roomId: string): LayoutVariant[] {
		const rows = this.db.prepare(
			"SELECT id, room_id, name, style, items_json, created_at FROM layout_variants WHERE room_id = ? ORDER BY created_at ASC",
		).all(roomId) as Array<{
			id: string; room_id: string; name: string; style: string | null; items_json: string; created_at: number;
		}>;
		return rows.map((row) => ({
			id: row.id,
			roomId: row.room_id,
			name: row.name,
			style: (row.style ?? "custom") as LayoutStyle | "custom",
			items: JSON.parse(row.items_json) as RoomItem[],
			createdAt: row.created_at,
		}));
	}

	saveVariant(roomId: string, name: string, items: RoomItem[], style: LayoutStyle | "custom" = "custom"): LayoutVariant {
		const room = this.getRoom(roomId);
		if (!room) throw new Error(`房间 ${roomId} 不存在。`);
		const existing = this.listVariants(roomId).find((v) => v.name === name.trim());
		const now = Date.now();
		if (existing) {
			this.db.prepare("UPDATE layout_variants SET style = ?, items_json = ?, created_at = ? WHERE id = ?")
				.run(style, JSON.stringify(items), now, existing.id);
			return { ...existing, style, items, createdAt: now };
		}
		const id = `var-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		this.db.prepare(
			"INSERT INTO layout_variants (id, room_id, name, style, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		).run(id, roomId, name.trim(), style, JSON.stringify(items), now);
		return { id, roomId, name: name.trim(), style, items, createdAt: now };
	}

	deleteVariant(variantId: string): boolean {
		const res = this.db.prepare("DELETE FROM layout_variants WHERE id = ?").run(variantId);
		return Number(res.changes) > 0;
	}

	applyVariant(roomId: string, variantId: string): RoomRecord {
		const variants = this.listVariants(roomId);
		const target = variants.find((v) => v.id === variantId || v.name === variantId);
		if (!target) throw new Error(`未找到布局方案 ${variantId}。`);
		return this.updateRoomLayout(roomId, target.items);
	}

	getOrCreateSession(sessionId = "public-default"): SessionRecord {
		const row = this.db.prepare(
			"SELECT id, active_room_id, draft_json, messages_json, updated_at FROM agent_sessions WHERE id = ?",
		).get(sessionId) as {
			id: string; active_room_id: string; draft_json: string | null; messages_json: string; updated_at: number;
		} | undefined;
		if (row) {
			return {
				id: row.id,
				activeRoomId: this.getRoom(row.active_room_id) ? row.active_room_id : (this.listRooms()[0]?.id ?? ROOM.id),
				draft: row.draft_json ? (JSON.parse(row.draft_json) as RoomDraft) : null,
				messages: JSON.parse(row.messages_json) as StoredChatMessage[],
				updatedAt: row.updated_at,
			};
		}
		const now = Date.now();
		const activeRoomId = this.listRooms()[0]?.id ?? ROOM.id;
		this.db.prepare(
			"INSERT INTO agent_sessions (id, workspace_id, active_room_id, draft_json, messages_json, updated_at) VALUES (?, 'default', ?, NULL, '[]', ?)",
		).run(sessionId, activeRoomId, now);
		return { id: sessionId, activeRoomId, draft: null, messages: [], updatedAt: now };
	}

	updateSessionActiveRoom(sessionId: string, roomId: string): void {
		if (!this.getRoom(roomId)) throw new Error(`房间 ${roomId} 不存在。`);
		this.getOrCreateSession(sessionId);
		this.db.prepare("UPDATE agent_sessions SET active_room_id = ?, updated_at = ? WHERE id = ?")
			.run(roomId, Date.now(), sessionId);
	}

	saveSessionDraft(sessionId: string, draft: RoomDraft | null): void {
		this.getOrCreateSession(sessionId);
		this.db.prepare("UPDATE agent_sessions SET draft_json = ?, updated_at = ? WHERE id = ?")
			.run(draft ? JSON.stringify(draft) : null, Date.now(), sessionId);
	}

	saveSessionMessages(sessionId: string, messages: StoredChatMessage[]): void {
		this.getOrCreateSession(sessionId);
		// Keep last 30 turns to keep context fast and compact
		const trimmed = messages.slice(-30);
		this.db.prepare("UPDATE agent_sessions SET messages_json = ?, updated_at = ? WHERE id = ?")
			.run(JSON.stringify(trimmed), Date.now(), sessionId);
	}

	getStudioSnapshot(sessionId = "public-default", roomIdOverride?: string): StudioSnapshot {
		const session = this.getOrCreateSession(sessionId);
		const rooms = this.listRooms();
		const targetId = roomIdOverride && rooms.some((r) => r.id === roomIdOverride)
			? roomIdOverride
			: session.activeRoomId;
		const activeRoom = rooms.find((r) => r.id === targetId) ?? rooms[0];
		if (!activeRoom) throw new Error("未找到任何房间数据。");
		const variants = this.listVariants(activeRoom.id);
		return { rooms, activeRoom, variants, draft: session.draft };
	}
}
