import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOM, buildRoomSpecFromDraft, fitToRoom, layoutWarning } from "../src/room/core/model.ts";
import { generateStyleLayout, resolveSemanticPlacement } from "../src/room/core/layout-engine.ts";
import { openStudioDatabase } from "../server/db/sqlite.ts";
import { RoomStudioRepository } from "../server/db/repository.ts";
import { createRoomStudioTools, validateCommitRoomDraftGuard } from "../server/agent/tools.ts";
import { formatLayoutInspection } from "../server/agent/replies.ts";
import { createStudioServer } from "../server/index.ts";
import { renderChatMarkdown } from "../src/room/chat-markdown.ts";

test("chat markdown renders plain and Chinese list markers as semantic lists", () => {
	const html = renderChatMarkdown("**检查结束。**\n\n- 房间\n- 过道\n\n### 待调整\n\n• 书桌\n● 椅子\n\n1、先移动书桌\n2）再复查");
	assert.equal((html.match(/<li>/g) ?? []).length, 6);
	assert.match(html, /<ul>\n<li>房间<\/li>/);
	assert.match(html, /<ul>\n<li>书桌<\/li>/);
	assert.match(html, /<ol>\n<li>先移动书桌<\/li>\n<li>再复查<\/li>/);
});

test("chat markdown wraps tables and leaves list-like examples in code unaltered", () => {
	const html = renderChatMarkdown("| 方案 | 冲突 |\n| --- | --- |\n| A | 0 |\n\n```text\n1、原始输入\n• 示例\n```\n\n<script>bad()</script>");
	assert.match(html, /<div class="msg-table-scroll"[^>]*><table>/);
	assert.match(html, /<pre><code[^>]*>1、原始输入\n• 示例\n<\/code><\/pre>/);
	assert.ok(!html.includes("<script>"));
});

test("layout inspection returns a summary and lists each conflict separately", () => {
	const metrics = { itemCount: 4, occupancyPercent: 25, conflicts: [], conflictCount: 0 };
	const clear = renderChatMarkdown(formatLayoutInspection(metrics));
	assert.match(clear, /<p><strong>未发现布局冲突。<\/strong><\/p>\n<ul>/);
	assert.doesNotMatch(clear, /冲突明细/);
	const blocked = renderChatMarkdown(formatLayoutInspection({
		...metrics,
		conflictCount: 2,
		conflicts: [
			{ id: "desk-1", label: "书桌", reason: "door" },
			{ id: "chair-1", label: "椅子", reason: "passage" },
		],
	}));
	assert.match(blocked, /<h3>冲突明细<\/h3>\n<ul>/);
	assert.match(blocked, /<li><strong>书桌<\/strong>：挡住入户门的开启空间。<\/li>/);
	assert.match(blocked, /<li><strong>椅子<\/strong>：占用入户过道。<\/li>/);
});

test("SQLite initializes default room and persists variants cleanly", () => {
	const db = openStudioDatabase(":memory:");
	const repo = new RoomStudioRepository(db);

	const rooms = repo.listRooms();
	assert.equal(rooms.length, 1);
	assert.equal(rooms[0].id, ROOM.id);
	assert.ok(rooms[0].items.length >= 6);

	const saved = repo.saveVariant(ROOM.id, "办公版", rooms[0].items.slice(0, 3), "work_focus");
	assert.equal(saved.name, "办公版");
	assert.equal(repo.listVariants(ROOM.id).length, 2);

	const applied = repo.applyVariant(ROOM.id, saved.id);
	assert.equal(applied.items.length, 3);
	db.close();
});

test("two-stage room draft guardrail blocks unconfirmed commits and preserves original room", async () => {
	const db = openStudioDatabase(":memory:");
	const repo = new RoomStudioRepository(db);
	const sessionId = "test-session";
	const tools = createRoomStudioTools(repo, sessionId);
	const updateDraft = tools.find((t) => t.name === "update_room_draft");
	const commitDraft = tools.find((t) => t.name === "commit_room_draft");
	assert.ok(updateDraft && commitDraft);

	// Before any draft exists, commit must be blocked
	assert.equal(validateCommitRoomDraftGuard(repo, sessionId, "确认").block, true);

	// Stage 1: Clarify partial user input -> creates draft with missing fields
	await updateDraft.execute("t1", { name: "新建次卧", widthCm: 500, depthCm: 400, hasBathroom: true }, new AbortController().signal);
	const session = repo.getOrCreateSession(sessionId);
	assert.ok(session.draft);
	assert.equal(session.draft.valid, true);
	assert.ok(session.draft.missingFields.length > 0);

	// Without explicit confirmation from user, guardrail must block
	assert.equal(validateCommitRoomDraftGuard(repo, sessionId, "我想再看看窗户放哪").block, true);

	// With confirmation, guardrail passes and commit creates a second room without overwriting original
	assert.equal(validateCommitRoomDraftGuard(repo, sessionId, "确认创建").block, false);
	await commitDraft.execute("t2", { populateStarterFurniture: true, starterStyle: "cozy_bedroom" }, new AbortController().signal);

	const allRooms = repo.listRooms();
	assert.equal(allRooms.length, 2);
	assert.equal(allRooms[0].id, ROOM.id);
	assert.equal(allRooms[1].name, "新建次卧");
	assert.equal(repo.getOrCreateSession(sessionId).draft, null);
	db.close();
});

test("semantic placement places desk under window and plant beside it without conflicts", () => {
	const deskRes = resolveSemanticPlacement(ROOM, [], { kind: "desk", anchor: "under_window" });
	assert.equal(deskRes.ok, true);
	assert.ok(deskRes.item);
	assert.equal(layoutWarning(deskRes.item, [], ROOM), undefined);

	const plantRes = resolveSemanticPlacement(ROOM, [deskRes.item], {
		kind: "plant",
		anchor: "beside_item",
		referenceItemId: deskRes.item.id,
		sideOfReference: "right",
	});
	assert.equal(plantRes.ok, true);
	assert.ok(plantRes.item);
	assert.equal(layoutWarning(plantRes.item, [deskRes.item], ROOM), undefined);
});

test("all four style auto-layouts produce conflict-free rooms and variant comparison works", async () => {
	const draft = buildRoomSpecFromDraft({
		name: "测试房间",
		widthCm: 560,
		depthCm: 420,
		doorSide: "east",
		windowSide: "west",
		hasBathroom: true,
		bathroomCorner: "south-east",
	});
	assert.equal(draft.valid, true);
	assert.ok(draft.spec);

	for (const style of ["work_focus", "relax_cinema", "cozy_bedroom", "minimal_spacious"]) {
		const layout = generateStyleLayout(draft.spec, style);
		assert.ok(layout.length >= 3, `${style} should place starter furniture`);
		for (const item of layout) {
			assert.deepEqual(fitToRoom(item, draft.spec), item);
			assert.equal(layoutWarning(item, layout, draft.spec), undefined, `${style}:${item.id}`);
		}
	}

	const db = openStudioDatabase(":memory:");
	const repo = new RoomStudioRepository(db);
	const tools = createRoomStudioTools(repo, "cmp-session");
	const arrange = tools.find((t) => t.name === "arrange_room_style");
	const manageVariant = tools.find((t) => t.name === "manage_layout_variant");

	await arrange.execute("t3", { style: "work_focus", saveAsVariantName: "方案A" }, new AbortController().signal);
	await arrange.execute("t4", { style: "minimal_spacious", saveAsVariantName: "方案B" }, new AbortController().signal);
	const cmpRes = await manageVariant.execute("t5", { action: "compare", name: "方案A", compareWith: "方案B" }, new AbortController().signal);
	const parsed = JSON.parse(cmpRes.content[0].text);
	assert.ok(parsed.summary.includes("方案A") && parsed.summary.includes("方案B"));
	db.close();
});

test("Hono server exposes health and rooms REST endpoints", async () => {
	const { app, db } = createStudioServer(":memory:");
	const health = await app.request("/api/health");
	assert.equal(health.status, 200);
	const healthJson = await health.json();
	assert.equal(healthJson.ok, true);

	const roomsRes = await app.request("/api/rooms");
	assert.equal(roomsRes.status, 200);
	const roomsJson = await roomsRes.json();
	assert.equal(roomsJson.snapshot.rooms.length, 1);
	db.close();
});
