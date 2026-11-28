import assert from "node:assert/strict";
import { test } from "node:test";
import { BATHROOM, PASSAGE, ROOM, fitToRoom, initialLayout, layoutWarning, nextPlacement, restoreLayout } from "../src/room/model.ts";

const one = (kind, x, z, rotation = 0) => ({ id: `${kind}-test`, kind, x, z, rotation });

test("a rotated item fits inside each room edge", () => {
	assert.deepEqual(fitToRoom(one("desk", -20, -20, -90)), one("desk", 31, 68, 270));
});

test("the entrance is centered in the passage and the wide window is offset", () => {
	assert.equal(ROOM.width * ROOM.depth / 10000, 25);
	assert.equal(BATHROOM.width, 225);
	assert.equal(BATHROOM.depth, 275);
	assert.equal(BATHROOM.x + BATHROOM.width, ROOM.width);
	assert.equal(BATHROOM.z + BATHROOM.depth, ROOM.depth);
	assert.equal(PASSAGE.x, BATHROOM.x);
	assert.equal(PASSAGE.x + PASSAGE.width, ROOM.width);
	assert.equal(PASSAGE.z, 0);
	assert.equal(PASSAGE.z + PASSAGE.depth, BATHROOM.z - BATHROOM.wallThickness / 2);
	assert.equal(BATHROOM.door.offset + BATHROOM.door.width / 2, PASSAGE.width / 2);
	assert.equal(ROOM.door.side, "east");
	assert.equal(ROOM.window.side, "west");
	assert.equal(ROOM.door.offset + ROOM.door.width / 2, PASSAGE.z + PASSAGE.depth / 2);
	assert.equal(ROOM.window.width, 220);
	assert.ok(ROOM.window.offset >= ROOM.door.offset + ROOM.door.width);
	assert.ok(ROOM.window.offset + ROOM.window.width <= ROOM.depth);
});

test("furniture is kept on the nearest available side of the bathroom", () => {
	assert.deepEqual(fitToRoom(one("desk", 615, 330)), one("desk", 327, 330));
	assert.deepEqual(fitToRoom(one("plant", 520, 115)), one("plant", 520, 96));
});

test("the default room has no furniture or door conflicts", () => {
	const items = initialLayout();
	for (const item of items) {
		assert.deepEqual(fitToRoom(item), item);
		assert.equal(layoutWarning(item, items), undefined, item.id);
	}
});

test("warns about overlapping footprints and the inward door swing", () => {
	const bed = one("bed", 100, 100);
	assert.equal(layoutWarning(one("chair", 111, 111), [bed]), "overlap");
	assert.equal(layoutWarning(one("chair", 590, 75), []), "door");
	assert.equal(layoutWarning(one("chair", 470, 75), []), "passage");
	assert.equal(layoutWarning(one("chair", 390, 370), []), undefined);
	assert.equal(layoutWarning(one("rug", 110, 110), [bed]), undefined);
});

test("furniture is added to a free spot and a full room returns no spot", () => {
	const items = initialLayout();
	const added = nextPlacement("chair", "chair-2", items);
	assert.ok(added);
	assert.equal(layoutWarning(added, items), undefined);
	assert.equal(nextPlacement("bed", "bed-2", [
		{ ...one("bed", 85, 100), id: "left-north" }, { ...one("bed", 85, 320), id: "left-south" },
		{ ...one("bed", 260, 100), id: "mid-north" }, { ...one("bed", 260, 320), id: "mid-south" },
		{ ...one("bed", 435, 100), id: "right-north" }, { ...one("bed", 435, 320), id: "right-south" },
	]), undefined);
});

test("saves can restore the default, but reject invalid or duplicate IDs", () => {
	assert.deepEqual(restoreLayout(JSON.parse(JSON.stringify(initialLayout()))), initialLayout());
	const chair = one("chair", 125, 130);
	assert.equal(restoreLayout([chair, chair]), undefined);
	assert.equal(restoreLayout([{ ...chair, x: NaN }]), undefined);
	assert.equal(restoreLayout([{ ...chair, kind: "unknown" }]), undefined);
});
