import {
	FURNITURE,
	fitToRoom,
	halfSize,
	isHorizontalWall,
	layoutWarning,
	nextPlacement,
	type FurnitureKind,
	type LayoutStyle,
	type LayoutVariant,
	type RoomItem,
	type RoomSpec,
	type WallSide,
} from "./model.ts";

export type SemanticAnchor =
	| "north_wall"
	| "south_wall"
	| "east_wall"
	| "west_wall"
	| "under_window"
	| "center"
	| "beside_item"
	| "in_front_of_item"
	| "coordinates";

export type FacingDirection = "north" | "south" | "east" | "west" | "window" | "center" | "away_from_wall";

export type SemanticPlacementRequest = {
	itemId?: string;
	kind?: FurnitureKind;
	anchor: SemanticAnchor;
	referenceItemId?: string;
	sideOfReference?: "left" | "right" | "front" | "back";
	align?: "start" | "center" | "end";
	gapCm?: number;
	xCm?: number;
	zCm?: number;
	facing?: FacingDirection;
};

export type SemanticPlacementResult = {
	ok: boolean;
	item?: RoomItem;
	nudgedCm: number;
	warning?: "door" | "passage" | "overlap";
	detail: string;
};

function wallRotationFacingRoom(side: WallSide): number {
	switch (side) {
		case "north": return 0;
		case "east": return 90;
		case "south": return 180;
		case "west": return 270;
	}
}

function directionToRotation(facing: FacingDirection, wallSide: WallSide | undefined, room: RoomSpec, x: number, z: number): number {
	switch (facing) {
		case "south": return 0;
		case "west": return 90;
		case "north": return 180;
		case "east": return 270;
		case "window": return wallRotationFacingRoom(room.window.side === "west" ? "east" : room.window.side === "east" ? "west" : room.window.side === "north" ? "south" : "north");
		case "away_from_wall": return wallSide ? wallRotationFacingRoom(wallSide) : 0;
		case "center": {
			const dx = room.width / 2 - x;
			const dz = room.depth / 2 - z;
			if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 270 : 90;
			return dz > 0 ? 0 : 180;
		}
	}
}

function nextItemId(kind: FurnitureKind, items: RoomItem[]): string {
	let n = 1;
	while (items.some((it) => it.id === `${kind}-${n}`)) n++;
	return `${kind}-${n}`;
}

/**
 * Resolve a semantic furniture placement or move into collision-checked room coordinates.
 */
export function resolveSemanticPlacement(
	room: RoomSpec,
	items: RoomItem[],
	req: SemanticPlacementRequest,
): SemanticPlacementResult {
	const existing = req.itemId ? items.find((i) => i.id === req.itemId) : undefined;
	if (req.itemId && !existing) {
		return { ok: false, nudgedCm: 0, detail: `未找到编号为 ${req.itemId} 的家具。` };
	}
	const kind = existing?.kind ?? req.kind;
	if (!kind) {
		return { ok: false, nudgedCm: 0, detail: "新增家具时必须提供家具类型 kind。" };
	}
	const id = existing?.id ?? nextItemId(kind, items);
	const others = items.filter((i) => i.id !== id);
	const gap = req.gapCm ?? 12;
	const align = req.align ?? "center";

	let targetX = existing?.x ?? room.width / 2;
	let targetZ = existing?.z ?? room.depth / 2;
	let rotation = existing?.rotation ?? 0;
	let wallSide: WallSide | undefined;

	if (req.anchor === "north_wall" || req.anchor === "south_wall" || req.anchor === "east_wall" || req.anchor === "west_wall") {
		wallSide = req.anchor.replace("_wall", "") as WallSide;
		rotation = req.facing ? directionToRotation(req.facing, wallSide, room, targetX, targetZ) : wallRotationFacingRoom(wallSide);
		const size = halfSize({ kind, rotation });
		if (isHorizontalWall(wallSide)) {
			targetZ = wallSide === "north" ? size.z + 6 : room.depth - size.z - 6;
			targetX = align === "start" ? size.x + 25 : align === "end" ? room.width - size.x - 25 : room.width / 2;
		} else {
			targetX = wallSide === "west" ? size.x + 6 : room.width - size.x - 6;
			targetZ = align === "start" ? size.z + 25 : align === "end" ? room.depth - size.z - 25 : room.depth / 2;
		}
	} else if (req.anchor === "under_window") {
		wallSide = room.window.side;
		rotation = req.facing ? directionToRotation(req.facing, wallSide, room, targetX, targetZ) : wallRotationFacingRoom(wallSide);
		const size = halfSize({ kind, rotation });
		const winCenter = room.window.offset + room.window.width / 2;
		if (isHorizontalWall(wallSide)) {
			targetX = winCenter;
			targetZ = wallSide === "north" ? size.z + 8 : room.depth - size.z - 8;
		} else {
			targetX = wallSide === "west" ? size.x + 8 : room.width - size.x - 8;
			targetZ = winCenter;
		}
	} else if (req.anchor === "center") {
		targetX = room.bathroom ? Math.round((room.width - room.bathroom.width) / 2) : Math.round(room.width / 2);
		targetZ = Math.round(room.depth / 2);
		if (req.facing) rotation = directionToRotation(req.facing, undefined, room, targetX, targetZ);
	} else if (req.anchor === "beside_item" || req.anchor === "in_front_of_item") {
		const ref = req.referenceItemId ? items.find((i) => i.id === req.referenceItemId) : undefined;
		if (!ref) {
			return { ok: false, nudgedCm: 0, detail: `参考家具 ${req.referenceItemId ?? "(未指定)"} 不存在。` };
		}
		rotation = req.facing ? directionToRotation(req.facing, undefined, room, ref.x, ref.z) : ref.rotation;
		const refHalf = halfSize(ref);
		const myHalf = halfSize({ kind, rotation });
		const side = req.anchor === "in_front_of_item" ? "front" : (req.sideOfReference ?? "right");
		if (side === "left") {
			targetX = ref.x - refHalf.x - myHalf.x - gap;
			targetZ = ref.z;
		} else if (side === "right") {
			targetX = ref.x + refHalf.x + myHalf.x + gap;
			targetZ = ref.z;
		} else if (side === "front") {
			targetX = ref.x;
			targetZ = ref.z + refHalf.z + myHalf.z + gap;
		} else {
			targetX = ref.x;
			targetZ = ref.z - refHalf.z - myHalf.z - gap;
		}
	} else if (req.anchor === "coordinates") {
		targetX = req.xCm ?? targetX;
		targetZ = req.zCm ?? targetZ;
		if (req.facing) rotation = directionToRotation(req.facing, undefined, room, targetX, targetZ);
	}

	const initial = fitToRoom({ id, kind, x: targetX, z: targetZ, rotation }, room);
	if (!layoutWarning(initial, others, room)) {
		return {
			ok: true,
			item: initial,
			nudgedCm: Math.round(Math.hypot(initial.x - targetX, initial.z - targetZ)),
			detail: `已将${FURNITURE[kind].label}放置于 (${initial.x}, ${initial.z}) cm，朝向 ${initial.rotation}°。`,
		};
	}

	// Search nearby valid spot within 120cm radius first, then fallback to whole room
	let bestCandidate: RoomItem | undefined;
	let bestDist = Infinity;
	for (let dx = -120; dx <= 120; dx += 15) {
		for (let dz = -120; dz <= 120; dz += 15) {
			const cand = fitToRoom({ id, kind, x: initial.x + dx, z: initial.z + dz, rotation }, room);
			if (layoutWarning(cand, others, room)) continue;
			const dist = Math.hypot(cand.x - initial.x, cand.z - initial.z);
			if (dist < bestDist) {
				bestDist = dist;
				bestCandidate = cand;
			}
		}
	}

	if (!bestCandidate) {
		bestCandidate = nextPlacement(kind, id, others, room);
	}
	if (!bestCandidate) {
		return {
			ok: false,
			nudgedCm: 0,
			warning: layoutWarning(initial, others, room),
			detail: `房间内没有足够空间无冲突摆放${FURNITURE[kind].label}。`,
		};
	}

	const nudgedCm = Math.round(Math.hypot(bestCandidate.x - initial.x, bestCandidate.z - initial.z));
	return {
		ok: true,
		item: bestCandidate,
		nudgedCm,
		detail: `已将${FURNITURE[kind].label}放置在 (${bestCandidate.x}, ${bestCandidate.z}) cm（自动避让冲突偏移 ${nudgedCm} cm）。`,
	};
}

/**
 * Generate a complete, zero-conflict furniture layout tailored to a lifestyle preset.
 */
export function generateStyleLayout(room: RoomSpec, style: LayoutStyle): RoomItem[] {
	const items: RoomItem[] = [];

	const tryPlace = (req: SemanticPlacementRequest): RoomItem | undefined => {
		const res = resolveSemanticPlacement(room, items, req);
		if (res.ok && res.item) {
			items.push(res.item);
			return res.item;
		}
		return undefined;
	};

	const mainWall: WallSide = room.window.side === "west" ? "south" : "north";
	const oppositeMain: WallSide = mainWall === "south" ? "north" : "south";

	if (style === "work_focus") {
		// Desk & chair centered right under the natural light window
		const desk = tryPlace({ kind: "desk", anchor: "under_window" });
		if (desk) {
			tryPlace({
				kind: "chair",
				anchor: "beside_item",
				referenceItemId: desk.id,
				sideOfReference: room.window.side === "west" ? "right" : room.window.side === "east" ? "left" : "front",
				gapCm: 10,
			});
		}
		// Bed along the quietest main wall, cabinet near desk, plant & lamp accents
		tryPlace({ kind: "bed", anchor: `${mainWall}_wall`, align: "center" });
		tryPlace({ kind: "cabinet", anchor: `${oppositeMain}_wall`, align: "center" });
		tryPlace({ kind: "plant", anchor: `${oppositeMain}_wall`, align: "end" });
		tryPlace({ kind: "lamp", anchor: `${mainWall}_wall`, align: "end" });
		tryPlace({ kind: "rug", anchor: "center" });
	} else if (style === "relax_cinema") {
		// Lounge sofa + rug + lamp take center stage, cabinet opposite as media console
		tryPlace({ kind: "rug", anchor: "center" });
		tryPlace({ kind: "sofa", anchor: `${mainWall}_wall`, align: "center" });
		tryPlace({ kind: "cabinet", anchor: `${oppositeMain}_wall`, align: "center" });
		tryPlace({ kind: "bed", anchor: `${mainWall}_wall`, align: "start" });
		tryPlace({ kind: "lamp", anchor: `${mainWall}_wall`, align: "end" });
		tryPlace({ kind: "plant", anchor: "under_window" });
	} else if (style === "minimal_spacious") {
		// Keep only essential bed + desk + chair + plant to maximize open floor area
		tryPlace({ kind: "bed", anchor: `${mainWall}_wall`, align: "start" });
		const desk = tryPlace({ kind: "desk", anchor: "under_window" });
		if (desk) {
			tryPlace({
				kind: "chair",
				anchor: "beside_item",
				referenceItemId: desk.id,
				sideOfReference: room.window.side === "west" ? "right" : "left",
				gapCm: 10,
			});
		}
		tryPlace({ kind: "plant", anchor: `${oppositeMain}_wall`, align: "end" });
	} else {
		// cozy_bedroom: balanced bedroom with bed, reading sofa, desk, cabinet, rug, lamp, plant
		tryPlace({ kind: "bed", anchor: `${mainWall}_wall`, align: "start" });
		const desk = tryPlace({ kind: "desk", anchor: `${oppositeMain}_wall`, align: "start" });
		if (desk) {
			tryPlace({ kind: "chair", anchor: "in_front_of_item", referenceItemId: desk.id, gapCm: 10 });
		}
		tryPlace({ kind: "sofa", anchor: `${mainWall}_wall`, align: "end" });
		tryPlace({ kind: "cabinet", anchor: `${oppositeMain}_wall`, align: "center" });
		tryPlace({ kind: "lamp", anchor: `${mainWall}_wall`, align: "center" });
		tryPlace({ kind: "plant", anchor: `${oppositeMain}_wall`, align: "end" });
		tryPlace({ kind: "rug", anchor: "center" });
	}

	return items;
}

export function computeLayoutMetrics(room: RoomSpec, items: RoomItem[]): {
	itemCount: number;
	occupiedAreaM2: number;
	usableAreaM2: number;
	occupancyPercent: number;
	conflictCount: number;
	conflicts: Array<{ id: string; label: string; reason: "door" | "passage" | "overlap" }>;
} {
	const bathroomArea = room.bathroom ? (room.bathroom.width * room.bathroom.depth) / 10000 : 0;
	const usableAreaM2 = Number(((room.width * room.depth) / 10000 - bathroomArea).toFixed(2));
	let occupiedCm2 = 0;
	const conflicts: Array<{ id: string; label: string; reason: "door" | "passage" | "overlap" }> = [];

	for (const item of items) {
		if (item.kind !== "rug") {
			occupiedCm2 += FURNITURE[item.kind].width * FURNITURE[item.kind].depth;
		}
		const warn = layoutWarning(item, items, room);
		if (warn) {
			conflicts.push({ id: item.id, label: FURNITURE[item.kind].label, reason: warn });
		}
	}

	const occupiedAreaM2 = Number((occupiedCm2 / 10000).toFixed(2));
	const occupancyPercent = usableAreaM2 > 0 ? Math.round((occupiedAreaM2 / usableAreaM2) * 100) : 0;
	return { itemCount: items.length, occupiedAreaM2, usableAreaM2, occupancyPercent, conflictCount: conflicts.length, conflicts };
}

export function compareLayoutVariants(room: RoomSpec, a: LayoutVariant, b: LayoutVariant): {
	summary: string;
	metricsA: ReturnType<typeof computeLayoutMetrics>;
	metricsB: ReturnType<typeof computeLayoutMetrics>;
	addedInB: string[];
	removedInB: string[];
	movedCount: number;
} {
	const metricsA = computeLayoutMetrics(room, a.items);
	const metricsB = computeLayoutMetrics(room, b.items);
	const mapA = new Map(a.items.map((it) => [it.id, it]));
	const mapB = new Map(b.items.map((it) => [it.id, it]));

	const addedInB: string[] = [];
	const removedInB: string[] = [];
	let movedCount = 0;

	for (const [id, it] of mapB) {
		const prev = mapA.get(id);
		if (!prev) addedInB.push(`${FURNITURE[it.kind].label}(${id})`);
		else if (prev.x !== it.x || prev.z !== it.z || prev.rotation !== it.rotation) movedCount++;
	}
	for (const [id, it] of mapA) {
		if (!mapB.has(id)) removedInB.push(`${FURNITURE[it.kind].label}(${id})`);
	}

	const summary = `「${a.name}」共 ${metricsA.itemCount} 件家具（占地率 ${metricsA.occupancyPercent}%，冲突 ${metricsA.conflictCount} 处）；「${b.name}」共 ${metricsB.itemCount} 件家具（占地率 ${metricsB.occupancyPercent}%，冲突 ${metricsB.conflictCount} 处）。对比差异：新增 ${addedInB.length} 件，移除 ${removedInB.length} 件，挪动 ${movedCount} 件。`;
	return { summary, metricsA, metricsB, addedInB, removedInB, movedCount };
}
