export type WallSide = "north" | "east" | "south" | "west";
export type RoomCorner = "north-east" | "south-east" | "south-west" | "north-west";

export type BathroomSpec = {
	x: number;
	z: number;
	width: number;
	depth: number;
	wallThickness: number;
	corner: RoomCorner;
	door: { offset: number; width: number; side: WallSide };
};

export type PassageSpec = {
	x: number;
	z: number;
	width: number;
	depth: number;
};

export type RoomSpec = {
	id: string;
	name: string;
	width: number;
	depth: number;
	height: number;
	window: { side: WallSide; offset: number; width: number; sill: number; height: number };
	door: { side: WallSide; offset: number; width: number; height: number };
	bathroom?: BathroomSpec;
	passage?: PassageSpec;
};

export type RoomDraftInput = {
	name?: string;
	widthCm?: number;
	depthCm?: number;
	heightCm?: number;
	doorSide?: WallSide;
	doorWidthCm?: number;
	doorOffsetCm?: number;
	windowSide?: WallSide;
	windowWidthCm?: number;
	windowOffsetCm?: number;
	hasBathroom?: boolean;
	bathroomCorner?: RoomCorner;
	bathroomWidthCm?: number;
	bathroomDepthCm?: number;
};

export type RoomDraft = {
	input: RoomDraftInput;
	spec?: RoomSpec;
	valid: boolean;
	errors: string[];
	missingFields: string[];
	assumedFields: string[];
	questionsForUser: string[];
	readyToCommit: boolean;
	updatedAt: number;
};

const FRAME = { width: 625, depth: 400 } as const;
const BATHROOM_WIDTH = 225;
const BATHROOM_DEPTH = 275;
const BATHROOM_DOOR_WIDTH = 80;

export const BATHROOM: BathroomSpec = {
	x: FRAME.width - BATHROOM_WIDTH,
	z: FRAME.depth - BATHROOM_DEPTH,
	width: BATHROOM_WIDTH,
	depth: BATHROOM_DEPTH,
	wallThickness: 10,
	corner: "south-east",
	door: { offset: (BATHROOM_WIDTH - BATHROOM_DOOR_WIDTH) / 2, width: BATHROOM_DOOR_WIDTH, side: "north" },
};

const ENTRY_WIDTH = 90;
export const PASSAGE: PassageSpec = {
	x: BATHROOM.x,
	z: 0,
	width: BATHROOM.width,
	depth: BATHROOM.z - BATHROOM.wallThickness / 2,
};

const ENTRY_AXIS = PASSAGE.z + PASSAGE.depth / 2;
export const ROOM: RoomSpec = {
	...FRAME,
	id: "personal-bedroom",
	name: "个人房间",
	height: 235,
	window: { side: "west", offset: 115, width: 220, sill: 98, height: 108 },
	door: { side: "east", offset: ENTRY_AXIS - ENTRY_WIDTH / 2, width: ENTRY_WIDTH, height: 210 },
	bathroom: BATHROOM,
	passage: PASSAGE,
};

export function isHorizontalWall(side: WallSide): boolean {
	return side === "north" || side === "south";
}

export function isMinWall(side: WallSide): boolean {
	return side === "north" || side === "west";
}

export function oppositeWall(side: WallSide): WallSide {
	switch (side) {
		case "north": return "south";
		case "south": return "north";
		case "east": return "west";
		case "west": return "east";
	}
}

export const FURNITURE = {
	bed: { label: "双人床", width: 162, depth: 206, color: "#8b9a78", icon: "M3 18v-8m18 8v-5H3m3 0V7h12v6M9 10h6" },
	desk: { label: "书桌", width: 136, depth: 62, color: "#b77d53", icon: "M3 8h18v4H3zM5 12v7m14-7v7m-7-7v4h7" },
	chair: { label: "座椅", width: 52, depth: 54, color: "#bb805e", icon: "M6 13V5h9v8m-9 0h12v3H6zM7 16v4m10-4v4" },
	sofa: { label: "双人沙发", width: 144, depth: 72, color: "#b47054", icon: "M5 13V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M5 13H3v5h18v-5h-2v2H5zM5 18v2m14-2v2" },
	cabinet: { label: "矮柜", width: 112, depth: 44, color: "#957052", icon: "M4 5h16v13H4zM4 11h16m-9-3h2m-2 6h2M6 18v2m12-2v2" },
	plant: { label: "绿植", width: 48, depth: 48, color: "#637b56", icon: "M8 15h8l-1 5H9zM12 15V8m0 4c0-5-3-6-6-6 0 4 3 6 6 6Zm0-2c0-4 3-6 6-6 0 4-2 6-6 6Z" },
	lamp: { label: "落地灯", width: 34, depth: 34, color: "#aa884d", icon: "M8 4h8l3 8H5zM12 12v8m-4 0h8" },
	rug: { label: "地毯", width: 164, depth: 143, color: "#a99a73", icon: "M5 4h14v16H5zM8 7h8v10H8zM5 2v2m14-2v2M5 20v2m14-2v2" },
} as const;

export type FurnitureKind = keyof typeof FURNITURE;
export type RoomItem = { id: string; kind: FurnitureKind; x: number; z: number; rotation: number };
export type RoomView = "plan" | "room";
export type LayoutStyle = "work_focus" | "relax_cinema" | "cozy_bedroom" | "minimal_spacious";
export type LayoutVariant = {
	id: string;
	roomId: string;
	name: string;
	style?: LayoutStyle | "custom";
	items: RoomItem[];
	createdAt: number;
};
export const CATALOG = Object.keys(FURNITURE) as FurnitureKind[];

export function initialLayout(): RoomItem[] {
	return [
		{ id: "bed-1", kind: "bed", x: 135, z: 266, rotation: 0 },
		{ id: "desk-1", kind: "desk", x: 45, z: 83, rotation: 270 },
		{ id: "chair-1", kind: "chair", x: 110, z: 83, rotation: 270 },
		{ id: "sofa-1", kind: "sofa", x: 300, z: 349, rotation: 180 },
		{ id: "cabinet-1", kind: "cabinet", x: 283, z: 32, rotation: 0 },
		{ id: "plant-1", kind: "plant", x: 366, z: 42, rotation: 0 },
		{ id: "lamp-1", kind: "lamp", x: 370, z: 243, rotation: 0 },
		{ id: "rug-1", kind: "rug", x: 289, z: 230, rotation: 0 },
	];
}

export function halfSize(item: Pick<RoomItem, "kind" | "rotation">): { x: number; z: number } {
	const { width, depth } = FURNITURE[item.kind];
	return item.rotation % 180 === 0 ? { x: width / 2, z: depth / 2 } : { x: depth / 2, z: width / 2 };
}

export function fitToRoom(item: RoomItem, room: RoomSpec = ROOM): RoomItem {
	const rotation = ((Math.round(item.rotation / 90) * 90 % 360) + 360) % 360;
	const size = halfSize({ kind: item.kind, rotation });
	const fitted = {
		...item,
		rotation,
		x: Math.min(room.width - size.x, Math.max(size.x, Math.round(item.x))),
		z: Math.min(room.depth - size.z, Math.max(size.z, Math.round(item.z))),
	};
	const bathroom = room.bathroom;
	if (!bathroom) return fitted;
	// Use the nearest legal side of the bathroom so bedroom furniture stays outside its walls.
	const clearance = bathroom.wallThickness / 2;
	const left = bathroom.x - clearance - size.x;
	const right = bathroom.x + bathroom.width + clearance + size.x;
	const north = bathroom.z - clearance - size.z;
	const south = bathroom.z + bathroom.depth + clearance + size.z;
	if (fitted.x <= left || fitted.x >= right || fitted.z <= north || fitted.z >= south) return fitted;
	const candidates = [
		{ ...fitted, x: left }, { ...fitted, x: right }, { ...fitted, z: north }, { ...fitted, z: south },
	].filter(({ x, z }) => x >= size.x && x <= room.width - size.x && z >= size.z && z <= room.depth - size.z);
	const distance = ({ x, z }: RoomItem): number => (x - fitted.x) ** 2 + (z - fitted.z) ** 2;
	return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? fitted;
}

export function layoutWarning(item: RoomItem, items: RoomItem[], room: RoomSpec = ROOM): "door" | "passage" | "overlap" | undefined {
	if (item.kind === "rug") return;
	const size = halfSize(item);
	const hinge = room.door.offset;
	const horizontal = isHorizontalWall(room.door.side);
	const edge = isMinWall(room.door.side) ? 0 : horizontal ? room.depth : room.width;
	const along = horizontal ? item.x : item.z;
	const alongHalf = horizontal ? size.x : size.z;
	const normal = horizontal ? item.z : item.x;
	const normalHalf = horizontal ? size.z : size.x;
	if (along + alongHalf > hinge) {
		const da = Math.max(0, along - alongHalf - hinge);
		const dn = Math.max(0, Math.abs(edge - normal) - normalHalf);
		if (da * da + dn * dn < room.door.width ** 2) return "door";
	}
	if (room.passage) {
		const p = room.passage;
		if (item.x + size.x > p.x && item.x - size.x < p.x + p.width &&
			item.z + size.z > p.z && item.z - size.z < p.z + p.depth) return "passage";
	}
	if (items.some((other) => {
		if (other.id === item.id || other.kind === "rug") return false;
		const size2 = halfSize(other);
		return Math.abs(item.x - other.x) < size.x + size2.x && Math.abs(item.z - other.z) < size.z + size2.z;
	})) return "overlap";
}

export function nextPlacement(kind: FurnitureKind, id: string, items: RoomItem[], room: RoomSpec = ROOM): RoomItem | undefined {
	const item = fitToRoom({ id, kind, x: room.width / 2, z: room.depth / 2, rotation: 0 }, room);
	if (!layoutWarning(item, items, room)) return item;
	let closest: RoomItem | undefined;
	let best = Infinity;
	for (let x = 0; x <= room.width; x += 10) {
		for (let z = 0; z <= room.depth; z += 10) {
			const candidate = fitToRoom({ ...item, x, z }, room);
			const distance = (candidate.x - item.x) ** 2 + (candidate.z - item.z) ** 2;
			if (distance >= best || layoutWarning(candidate, items, room)) continue;
			best = distance;
			closest = candidate;
		}
	}
	return closest;
}

export function restoreLayout(value: unknown, room: RoomSpec = ROOM): RoomItem[] | undefined {
	if (!Array.isArray(value) || value.length > 40) return;
	const items: RoomItem[] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== "object" || candidate === null) return;
		const item = candidate as Partial<RoomItem>;
		if (typeof item.id !== "string" || ids.has(item.id) || typeof item.kind !== "string" ||
			!Object.hasOwn(FURNITURE, item.kind) || typeof item.x !== "number" || !Number.isFinite(item.x) ||
			typeof item.z !== "number" || !Number.isFinite(item.z) || typeof item.rotation !== "number" ||
			!Number.isFinite(item.rotation)) return;
		ids.add(item.id);
		items.push(fitToRoom({ id: item.id, kind: item.kind, x: item.x, z: item.z, rotation: item.rotation }, room));
	}
	return items;
}

/**
 * Validate and build a structured RoomSpec from a partial user/agent draft.
 * Clearly distinguishes missing fields vs assumed defaults for Clarify-then-Act workflow.
 */
export function buildRoomSpecFromDraft(input: RoomDraftInput, id = `room-${Date.now().toString(36)}`): {
	valid: boolean;
	errors: string[];
	missingFields: string[];
	assumedFields: string[];
	spec?: RoomSpec;
} {
	const errors: string[] = [];
	const missingFields: string[] = [];
	const assumedFields: string[] = [];

	const width = input.widthCm ?? 500;
	const depth = input.depthCm ?? 400;
	const height = input.heightCm ?? 240;

	if (input.widthCm == null) missingFields.push("房间宽度 (widthCm)");
	if (input.depthCm == null) missingFields.push("房间进深 (depthCm)");
	if (input.heightCm == null) assumedFields.push("层高暂定 2.40m");

	if (width < 240 || width > 1200) errors.push("房间宽度需在 2.4m ~ 12.0m 之间。");
	if (depth < 240 || depth > 1200) errors.push("房间进深需在 2.4m ~ 12.0m 之间。");
	if (height < 210 || height > 450) errors.push("层高需在 2.1m ~ 4.5m 之间。");

	const doorSide: WallSide = input.doorSide ?? "east";
	if (!input.doorSide) missingFields.push("入户门所在墙面 (doorSide)");

	const windowSide: WallSide = input.windowSide ?? oppositeWall(doorSide);
	if (!input.windowSide) missingFields.push("采光窗所在墙面 (windowSide)");
	if (windowSide === doorSide) errors.push("入户门与采光窗建议分布在不同墙面上，避免重叠冲突。");

	const hasBathroom = input.hasBathroom ?? false;
	if (input.hasBathroom == null) missingFields.push("是否需要独立卫生间 (hasBathroom)");

	let bathroom: BathroomSpec | undefined;
	let passage: PassageSpec | undefined;

	if (hasBathroom) {
		const corner: RoomCorner = input.bathroomCorner ?? "south-east";
		if (!input.bathroomCorner) assumedFields.push(`卫生间位置暂定 ${corner}`);
		const bw = input.bathroomWidthCm ?? Math.min(220, Math.round(width * 0.36));
		const bd = input.bathroomDepthCm ?? Math.min(240, Math.round(depth * 0.55));
		if (input.bathroomWidthCm == null || input.bathroomDepthCm == null) {
			assumedFields.push(`卫生间尺寸暂定 ${(bw / 100).toFixed(2)} × ${(bd / 100).toFixed(2)} m`);
		}
		if (bw < 120 || bd < 120) errors.push("卫生间宽深均不能小于 1.20m。");
		if (bw > width - 110 || bd > depth - 110) {
			errors.push("卫生间尺寸过大，需为主房间留出至少 1.10m 的通道空间。");
		}
		const bx = corner.endsWith("east") ? width - bw : 0;
		const bz = corner.startsWith("south") ? depth - bd : 0;
		const wallThickness = 10;
		const bathDoorWidth = Math.min(80, Math.max(65, bw - 30));
		const bathDoorSide: WallSide = corner.startsWith("south") ? "north" : "south";
		bathroom = {
			x: bx,
			z: bz,
			width: bw,
			depth: bd,
			wallThickness,
			corner,
			door: { offset: Math.round((bw - bathDoorWidth) / 2), width: bathDoorWidth, side: bathDoorSide },
		};
		// Create passage between bathroom and opposite wall along vertical axis when door is east/west
		if ((doorSide === "east" && corner.endsWith("east")) || (doorSide === "west" && corner.endsWith("west"))) {
			const pz = corner.startsWith("south") ? 0 : bd + wallThickness / 2;
			const pd = corner.startsWith("south") ? bz - wallThickness / 2 : depth - bd - wallThickness / 2;
			if (pd >= 95) {
				passage = { x: bx, z: pz, width: bw, depth: pd };
			}
		}
	}

	const doorWallLen = isHorizontalWall(doorSide) ? width : depth;
	const doorWidth = input.doorWidthCm ?? 90;
	if (input.doorWidthCm == null) assumedFields.push("入户门宽暂定 0.90m");

	let doorOffset = input.doorOffsetCm;
	if (doorOffset == null) {
		if (passage && !isHorizontalWall(doorSide)) {
			doorOffset = Math.round(passage.z + (passage.depth - doorWidth) / 2);
		} else {
			doorOffset = Math.round((doorWallLen - doorWidth) / 2);
		}
		assumedFields.push("入户门沿墙偏移暂定居中");
	}
	if (doorOffset < 5 || doorOffset + doorWidth > doorWallLen - 5) {
		errors.push("入户门开口超出墙体边界。");
	}

	const winWallLen = isHorizontalWall(windowSide) ? width : depth;
	const winWidth = input.windowWidthCm ?? Math.min(200, Math.round(winWallLen * 0.5));
	if (input.windowWidthCm == null) assumedFields.push(`采光窗宽暂定 ${(winWidth / 100).toFixed(2)}m`);
	const winOffset = input.windowOffsetCm ?? Math.round((winWallLen - winWidth) / 2);
	if (input.windowOffsetCm == null) assumedFields.push("采光窗沿墙位置暂定居中");
	if (winOffset < 10 || winOffset + winWidth > winWallLen - 10) {
		errors.push("采光窗开口超出墙体边界。");
	}

	const valid = errors.length === 0;
	const spec: RoomSpec | undefined = valid ? {
		id,
		name: input.name?.trim() || "新建房间",
		width: Math.round(width),
		depth: Math.round(depth),
		height: Math.round(height),
		door: { side: doorSide, offset: Math.round(doorOffset), width: Math.round(doorWidth), height: 210 },
		window: { side: windowSide, offset: Math.round(winOffset), width: Math.round(winWidth), sill: 95, height: 110 },
		...(bathroom ? { bathroom } : {}),
		...(passage ? { passage } : {}),
	} : undefined;

	return { valid, errors, missingFields, assumedFields, spec };
}
