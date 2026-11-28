import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ROOM, initialLayout } from "../../src/room/core/model.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openStudioDatabase(dbPath: string): DatabaseSync {
	if (dbPath !== ":memory:") {
		const resolved = path.resolve(process.cwd(), dbPath);
		fs.mkdirSync(path.dirname(resolved), { recursive: true });
		dbPath = resolved;
	}
	const db = new DatabaseSync(dbPath);
	const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
	db.exec(schema);

	// Seed default public room if empty
	const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM rooms").get() as { cnt: number };
	if (countRow.cnt === 0) {
		const now = Date.now();
		const starter = initialLayout();
		db.prepare(
			"INSERT INTO rooms (id, workspace_id, name, spec_json, items_json, created_at, updated_at) VALUES (?, 'default', ?, ?, ?, ?, ?)",
		).run(ROOM.id, ROOM.name, JSON.stringify(ROOM), JSON.stringify(starter), now, now);

		db.prepare(
			"INSERT INTO layout_variants (id, room_id, name, style, items_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		).run("variant-default", ROOM.id, "默认布局", "custom", JSON.stringify(starter), now);
	}
	return db;
}
