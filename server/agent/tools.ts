import { Type } from "typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
	FURNITURE,
	buildRoomSpecFromDraft,
	fitToRoom,
	type FurnitureKind,
	type LayoutStyle,
	type RoomCorner,
	type RoomDraft,
	type RoomDraftInput,
	type WallSide,
} from "../../src/room/core/model.ts";
import {
	compareLayoutVariants,
	computeLayoutMetrics,
	generateStyleLayout,
	resolveSemanticPlacement,
	type FacingDirection,
	type SemanticAnchor,
} from "../../src/room/core/layout-engine.ts";
import type { RoomStudioRepository, StudioSnapshot } from "../db/repository.ts";

export type ToolEventCallbacks = {
	onDraftUpdated?: (draft: RoomDraft | null) => void;
	onSceneSync?: (snapshot: StudioSnapshot) => void;
};

const WallSideSchema = Type.Union([
	Type.Literal("north"),
	Type.Literal("east"),
	Type.Literal("south"),
	Type.Literal("west"),
]);

const CornerSchema = Type.Union([
	Type.Literal("north-east"),
	Type.Literal("south-east"),
	Type.Literal("south-west"),
	Type.Literal("north-west"),
]);

const FurnitureKindSchema = Type.Union([
	Type.Literal("bed"),
	Type.Literal("desk"),
	Type.Literal("chair"),
	Type.Literal("sofa"),
	Type.Literal("cabinet"),
	Type.Literal("plant"),
	Type.Literal("lamp"),
	Type.Literal("rug"),
]);

const AnchorSchema = Type.Union([
	Type.Literal("north_wall"),
	Type.Literal("south_wall"),
	Type.Literal("east_wall"),
	Type.Literal("west_wall"),
	Type.Literal("under_window"),
	Type.Literal("center"),
	Type.Literal("beside_item"),
	Type.Literal("in_front_of_item"),
	Type.Literal("coordinates"),
]);

const FacingSchema = Type.Union([
	Type.Literal("north"),
	Type.Literal("south"),
	Type.Literal("east"),
	Type.Literal("west"),
	Type.Literal("window"),
	Type.Literal("center"),
	Type.Literal("away_from_wall"),
]);

const LayoutStyleSchema = Type.Union([
	Type.Literal("work_focus"),
	Type.Literal("relax_cinema"),
	Type.Literal("cozy_bedroom"),
	Type.Literal("minimal_spacious"),
]);

const CONFIRM_PATTERN = /(确认|可以|好的|好呀|同意|没问题|就这样|按默认|按这个|创建吧|建吧|执行|proceed|confirm|yes)/i;

/**
 * Hard guardrail used in PiAgent's `beforeToolCall` hook:
 * Prevents `commit_room_draft` from executing before a valid draft exists and is confirmed by the user.
 */
export function validateCommitRoomDraftGuard(
	repo: RoomStudioRepository,
	sessionId: string,
	latestUserMessage: string,
	explicitConfirmFlag = false,
): { block: boolean; reason?: string } {
	const session = repo.getOrCreateSession(sessionId);
	if (!session.draft) {
		return {
			block: true,
			reason: "当前还没有建房草稿。请先调用 update_room_draft 梳理房间需求并与用户确认后再提交创建。",
		};
	}
	if (!session.draft.valid || !session.draft.spec) {
		return {
			block: true,
			reason: `当前建房草稿几何校验未通过：${session.draft.errors.join("；")}。请先调用 update_room_draft 修正后再提交。`,
		};
	}
	if (!explicitConfirmFlag && !CONFIRM_PATTERN.test(latestUserMessage)) {
		return {
			block: true,
			reason: "用户尚未明确确认该建房草稿。请先向用户展示草稿参数并询问是否确认创建，待用户回复确认后再调用 commit_room_draft。",
		};
	}
	return { block: false };
}

export function createRoomStudioTools(
	repo: RoomStudioRepository,
	sessionId: string,
	callbacks: ToolEventCallbacks = {},
): AgentTool<any>[] {
	const getStudioContextParams = Type.Object({
		includeMetrics: Type.Optional(Type.Boolean({ description: "是否包含占地率与冲突统计" })),
	});

	const getStudioContext: AgentTool<typeof getStudioContextParams> = {
		name: "get_studio_context",
		label: "读取房间与布局状态",
		description: "读取当前工作台的所有房间列表、当前激活房间的详细尺寸、门窗与卫生间位置、已摆家具列表以及已保存的布局方案。",
		parameters: getStudioContextParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			const snap = repo.getStudioSnapshot(sessionId);
			const metrics = params.includeMetrics !== false
				? computeLayoutMetrics(snap.activeRoom.spec, snap.activeRoom.items)
				: undefined;
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						activeRoom: snap.activeRoom,
						rooms: snap.rooms.map((r) => ({ id: r.id, name: r.name, width: r.spec.width, depth: r.spec.depth })),
						variants: snap.variants.map((v) => ({ id: v.id, name: v.name, style: v.style, count: v.items.length })),
						draft: snap.draft,
						metrics,
					}),
				}],
				details: { roomId: snap.activeRoom.id, itemCount: snap.activeRoom.items.length },
			};
		},
	};

	const inspectConflictsParams = Type.Object({});
	const inspectLayoutConflicts: AgentTool<typeof inspectConflictsParams> = {
		name: "inspect_layout_conflicts",
		label: "诊断空间冲突与动线",
		description: "检测当前房间所有家具是否存在挡门（door）、占用过道（passage）或相互重叠（overlap）冲突，并返回占地率指标。",
		parameters: inspectConflictsParams,
		executionMode: "sequential",
		execute: async () => {
			const snap = repo.getStudioSnapshot(sessionId);
			const metrics = computeLayoutMetrics(snap.activeRoom.spec, snap.activeRoom.items);
			return {
				content: [{ type: "text", text: JSON.stringify(metrics) }],
				details: { conflictCount: metrics.conflictCount, occupancyPercent: metrics.occupancyPercent },
			};
		},
	};

	const updateDraftParams = Type.Object({
		name: Type.Optional(Type.String({ description: "新房间名称，例如：次卧、书房、主卧" })),
		widthCm: Type.Optional(Type.Number({ description: "房间横向宽度（厘米），例如 500 表示 5 米" })),
		depthCm: Type.Optional(Type.Number({ description: "房间纵向进深（厘米），例如 400 表示 4 米" })),
		heightCm: Type.Optional(Type.Number({ description: "层高（厘米），默认 240" })),
		doorSide: Type.Optional(WallSideSchema),
		doorWidthCm: Type.Optional(Type.Number({ description: "入户门宽度（厘米），默认 90" })),
		doorOffsetCm: Type.Optional(Type.Number({ description: "入户门沿墙起始偏移（厘米）" })),
		windowSide: Type.Optional(WallSideSchema),
		windowWidthCm: Type.Optional(Type.Number({ description: "采光窗宽度（厘米）" })),
		windowOffsetCm: Type.Optional(Type.Number({ description: "采光窗沿墙起始偏移（厘米）" })),
		hasBathroom: Type.Optional(Type.Boolean({ description: "是否隔出独立卫生间" })),
		bathroomCorner: Type.Optional(CornerSchema),
		bathroomWidthCm: Type.Optional(Type.Number({ description: "卫生间宽度（厘米）" })),
		bathroomDepthCm: Type.Optional(Type.Number({ description: "卫生间进深（厘米）" })),
		questionsForUser: Type.Optional(Type.Array(Type.String(), { description: "需要向用户追问的简短问题列表" })),
		clearDraft: Type.Optional(Type.Boolean({ description: "若用户取消新建房间，传 true 清空草稿" })),
	});

	const updateRoomDraft: AgentTool<typeof updateDraftParams> = {
		name: "update_room_draft",
		label: "梳理并更新建房草稿",
		description: "需求梳理阶段专用工具：把用户提到的房间尺寸、门窗和卫生间信息合并到草稿中并做几何预检，在界面上显示需求梳理卡片和 3D 预览，但不正式创建房间。",
		parameters: updateDraftParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			if (params.clearDraft) {
				repo.saveSessionDraft(sessionId, null);
				callbacks.onDraftUpdated?.(null);
				return {
					content: [{ type: "text", text: "已清空当前建房草稿。" }],
					details: { cleared: true },
				};
			}

			const session = repo.getOrCreateSession(sessionId);
			const prevInput: RoomDraftInput = session.draft?.input ?? {};
			const merged: RoomDraftInput = {
				...prevInput,
				...(params.name !== undefined ? { name: params.name } : {}),
				...(params.widthCm !== undefined ? { widthCm: params.widthCm } : {}),
				...(params.depthCm !== undefined ? { depthCm: params.depthCm } : {}),
				...(params.heightCm !== undefined ? { heightCm: params.heightCm } : {}),
				...(params.doorSide !== undefined ? { doorSide: params.doorSide as WallSide } : {}),
				...(params.doorWidthCm !== undefined ? { doorWidthCm: params.doorWidthCm } : {}),
				...(params.doorOffsetCm !== undefined ? { doorOffsetCm: params.doorOffsetCm } : {}),
				...(params.windowSide !== undefined ? { windowSide: params.windowSide as WallSide } : {}),
				...(params.windowWidthCm !== undefined ? { windowWidthCm: params.windowWidthCm } : {}),
				...(params.windowOffsetCm !== undefined ? { windowOffsetCm: params.windowOffsetCm } : {}),
				...(params.hasBathroom !== undefined ? { hasBathroom: params.hasBathroom } : {}),
				...(params.bathroomCorner !== undefined ? { bathroomCorner: params.bathroomCorner as RoomCorner } : {}),
				...(params.bathroomWidthCm !== undefined ? { bathroomWidthCm: params.bathroomWidthCm } : {}),
				...(params.bathroomDepthCm !== undefined ? { bathroomDepthCm: params.bathroomDepthCm } : {}),
			};

			const checked = buildRoomSpecFromDraft(merged, `draft-preview`);
			const draft: RoomDraft = {
				input: merged,
				spec: checked.spec,
				valid: checked.valid,
				errors: checked.errors,
				missingFields: checked.missingFields,
				assumedFields: checked.assumedFields,
				questionsForUser: params.questionsForUser ?? [],
				readyToCommit: checked.valid,
				updatedAt: Date.now(),
			};

			repo.saveSessionDraft(sessionId, draft);
			callbacks.onDraftUpdated?.(draft);

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						status: "draft_updated",
						valid: draft.valid,
						errors: draft.errors,
						missingFields: draft.missingFields,
						assumedFields: draft.assumedFields,
						previewSpec: draft.spec,
					}),
				}],
				details: { valid: draft.valid, missingCount: draft.missingFields.length },
			};
		},
	};

	const commitDraftParams = Type.Object({
		populateStarterFurniture: Type.Optional(Type.Boolean({ description: "创建房间后是否自动摆放一套基础无冲突家具（默认 true）" })),
		starterStyle: Type.Optional(LayoutStyleSchema),
	});

	const commitRoomDraft: AgentTool<typeof commitDraftParams> = {
		name: "commit_room_draft",
		label: "确认创建新房间",
		description: "仅在用户明确确认建房草稿后调用：将当前建房草稿正式落库为新房间并切换过去，不会覆盖原有房间。",
		parameters: commitDraftParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			const session = repo.getOrCreateSession(sessionId);
			if (!session.draft || !session.draft.valid || !session.draft.spec) {
				throw new Error("当前没有通过校验的建房草稿，无法创建房间。");
			}
			const newId = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
			const finalSpec = { ...session.draft.spec, id: newId };
			const style: LayoutStyle = (params.starterStyle as LayoutStyle | undefined) ?? "cozy_bedroom";
			const starterItems = params.populateStarterFurniture === false ? [] : generateStyleLayout(finalSpec, style);

			const created = repo.createRoom(finalSpec, starterItems);
			repo.saveVariant(created.id, "初始布局", starterItems, style);
			repo.updateSessionActiveRoom(sessionId, created.id);
			repo.saveSessionDraft(sessionId, null);

			const snap = repo.getStudioSnapshot(sessionId, created.id);
			callbacks.onDraftUpdated?.(null);
			callbacks.onSceneSync?.(snap);

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: true,
						createdRoom: { id: created.id, name: created.name, width: finalSpec.width, depth: finalSpec.depth },
						furnitureCount: starterItems.length,
					}),
				}],
				details: { roomId: created.id, name: created.name, furnitureCount: starterItems.length },
			};
		},
	};

	const switchRoomParams = Type.Object({
		roomId: Type.String({ description: "要切换的目标房间 ID" }),
	});

	const switchRoom: AgentTool<typeof switchRoomParams> = {
		name: "switch_room",
		label: "切换当前房间",
		description: "在已创建的多个房间之间切换当前工作台视图。",
		parameters: switchRoomParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			repo.updateSessionActiveRoom(sessionId, params.roomId);
			const snap = repo.getStudioSnapshot(sessionId, params.roomId);
			callbacks.onSceneSync?.(snap);
			return {
				content: [{ type: "text", text: `已切换到房间「${snap.activeRoom.name}」(${snap.activeRoom.id})。` }],
				details: { roomId: snap.activeRoom.id, name: snap.activeRoom.name },
			};
		},
	};

	const placeOrMoveParams = Type.Object({
		itemId: Type.Optional(Type.String({ description: "要移动的现有家具 ID（如 desk-1）；留空则表示新增家具" })),
		kind: Type.Optional(FurnitureKindSchema),
		anchor: AnchorSchema,
		referenceItemId: Type.Optional(Type.String({ description: "当 anchor 为 beside_item 或 in_front_of_item 时的参考家具 ID" })),
		sideOfReference: Type.Optional(Type.Union([
			Type.Literal("left"), Type.Literal("right"), Type.Literal("front"), Type.Literal("back"),
		])),
		align: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("center"), Type.Literal("end")])),
		gapCm: Type.Optional(Type.Number({ description: "与参考家具的间距（厘米），默认 12" })),
		xCm: Type.Optional(Type.Number({ description: "当 anchor 为 coordinates 时的 X 坐标（厘米）" })),
		zCm: Type.Optional(Type.Number({ description: "当 anchor 为 coordinates 时的 Z 坐标（厘米）" })),
		facing: Type.Optional(FacingSchema),
	});

	const placeOrMoveFurniture: AgentTool<typeof placeOrMoveParams> = {
		name: "place_or_move_furniture",
		label: "语义化摆放或移动家具",
		description: "按语义位置（如贴北墙、放采光窗下、房间居中、在某件家具旁边或指定坐标）新增或移动家具，自动避让卫生间和碰撞冲突。",
		parameters: placeOrMoveParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			const snap = repo.getStudioSnapshot(sessionId);
			const room = snap.activeRoom;
			const result = resolveSemanticPlacement(room.spec, room.items, {
				itemId: params.itemId,
				kind: params.kind as FurnitureKind | undefined,
				anchor: params.anchor as SemanticAnchor,
				referenceItemId: params.referenceItemId,
				sideOfReference: params.sideOfReference,
				align: params.align,
				gapCm: params.gapCm,
				xCm: params.xCm,
				zCm: params.zCm,
				facing: params.facing as FacingDirection | undefined,
			});
			if (!result.ok || !result.item) {
				throw new Error(result.detail);
			}

			const placed = result.item;
			const exists = room.items.some((it) => it.id === placed.id);
			const nextItems = exists
				? room.items.map((it) => (it.id === placed.id ? placed : it))
				: [...room.items, placed];

			repo.updateRoomLayout(room.id, nextItems);
			const updatedSnap = repo.getStudioSnapshot(sessionId, room.id);
			callbacks.onSceneSync?.(updatedSnap);

			return {
				content: [{ type: "text", text: JSON.stringify({ ok: true, item: placed, nudgedCm: result.nudgedCm, detail: result.detail }) }],
				details: { itemId: placed.id, kind: placed.kind, x: placed.x, z: placed.z, nudgedCm: result.nudgedCm },
			};
		},
	};

	const modifyFurnitureParams = Type.Object({
		itemId: Type.String({ description: "目标家具 ID，如 bed-1" }),
		action: Type.Union([
			Type.Literal("rotate_90"),
			Type.Literal("rotate_minus_90"),
			Type.Literal("set_rotation"),
			Type.Literal("remove"),
		]),
		rotation: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(90), Type.Literal(180), Type.Literal(270)])),
	});

	const modifyFurniture: AgentTool<typeof modifyFurnitureParams> = {
		name: "modify_furniture",
		label: "旋转或移除家具",
		description: "旋转指定家具的角度（90度步进）或将其从当前房间移除。",
		parameters: modifyFurnitureParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			const snap = repo.getStudioSnapshot(sessionId);
			const room = snap.activeRoom;
			const target = room.items.find((it) => it.id === params.itemId);
			if (!target) throw new Error(`未找到家具 ${params.itemId}。`);

			let nextItems = room.items;
			let message = "";
			if (params.action === "remove") {
				nextItems = room.items.filter((it) => it.id !== params.itemId);
				message = `已移除${FURNITURE[target.kind].label} (${target.id})。`;
			} else {
				const nextRot = params.action === "set_rotation"
					? (params.rotation ?? 0)
					: target.rotation + (params.action === "rotate_90" ? 90 : -90);
				const updated = fitToRoom({ ...target, rotation: nextRot }, room.spec);
				nextItems = room.items.map((it) => (it.id === target.id ? updated : it));
				message = `已将${FURNITURE[target.kind].label}旋转至 ${updated.rotation}°。`;
			}

			repo.updateRoomLayout(room.id, nextItems);
			const updatedSnap = repo.getStudioSnapshot(sessionId, room.id);
			callbacks.onSceneSync?.(updatedSnap);

			return {
				content: [{ type: "text", text: message }],
				details: { itemId: params.itemId, action: params.action },
			};
		},
	};

	const arrangeStyleParams = Type.Object({
		style: LayoutStyleSchema,
		saveAsVariantName: Type.Optional(Type.String({ description: "如果提供名称，生成后自动保存为一个命名布局方案快照" })),
	});

	const arrangeRoomStyle: AgentTool<typeof arrangeStyleParams> = {
		name: "arrange_room_style",
		label: "场景化一键自动布局",
		description: "按指定生活方式（work_focus 居家办公优先 / relax_cinema 休闲观影 / cozy_bedroom 温馨卧室 / minimal_spacious 极简宽敞）为当前房间重新自动排布一套零冲突的家具布局。",
		parameters: arrangeStyleParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			const snap = repo.getStudioSnapshot(sessionId);
			const room = snap.activeRoom;
			const style = params.style as LayoutStyle;
			const generated = generateStyleLayout(room.spec, style);
			repo.updateRoomLayout(room.id, generated);

			let savedVariantName: string | undefined;
			if (params.saveAsVariantName?.trim()) {
				const v = repo.saveVariant(room.id, params.saveAsVariantName.trim(), generated, style);
				savedVariantName = v.name;
			}

			const updatedSnap = repo.getStudioSnapshot(sessionId, room.id);
			const metrics = computeLayoutMetrics(room.spec, generated);
			callbacks.onSceneSync?.(updatedSnap);

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						ok: true,
						style,
						savedVariantName,
						itemCount: generated.length,
						occupancyPercent: metrics.occupancyPercent,
						conflictCount: metrics.conflictCount,
					}),
				}],
				details: { style, itemCount: generated.length, savedVariantName },
			};
		},
	};

	const manageVariantParams = Type.Object({
		action: Type.Union([
			Type.Literal("save"),
			Type.Literal("load"),
			Type.Literal("list"),
			Type.Literal("delete"),
			Type.Literal("compare"),
		]),
		name: Type.Optional(Type.String({ description: "方案名称（用于 save / load / delete / compare 的方案 A）" })),
		compareWith: Type.Optional(Type.String({ description: "用于 compare 时的方案 B 名称" })),
	});

	const manageLayoutVariant: AgentTool<typeof manageVariantParams> = {
		name: "manage_layout_variant",
		label: "管理与对比布局方案快照",
		description: "保存当前家具布局为命名方案、一键加载切换已有方案、删除方案，或对两套已保存方案进行数据化对比。",
		parameters: manageVariantParams,
		executionMode: "sequential",
		execute: async (_id, params) => {
			const snap = repo.getStudioSnapshot(sessionId);
			const room = snap.activeRoom;
			const variants = snap.variants;

			if (params.action === "list") {
				return {
					content: [{ type: "text", text: JSON.stringify(variants.map((v) => ({ id: v.id, name: v.name, style: v.style, count: v.items.length }))) }],
					details: { count: variants.length },
				};
			}

			if (params.action === "save") {
				const name = params.name?.trim() || `方案-${variants.length + 1}`;
				const saved = repo.saveVariant(room.id, name, room.items, "custom");
				const updatedSnap = repo.getStudioSnapshot(sessionId, room.id);
				callbacks.onSceneSync?.(updatedSnap);
				return {
					content: [{ type: "text", text: `已将当前布局保存为方案「${saved.name}」（共 ${saved.items.length} 件家具）。` }],
					details: { variantId: saved.id, name: saved.name },
				};
			}

			if (params.action === "load") {
				const target = variants.find((v) => v.name === params.name || v.id === params.name);
				if (!target) throw new Error(`未找到名为「${params.name}」的方案。`);
				repo.applyVariant(room.id, target.id);
				const updatedSnap = repo.getStudioSnapshot(sessionId, room.id);
				callbacks.onSceneSync?.(updatedSnap);
				return {
					content: [{ type: "text", text: `已切换到方案「${target.name}」。` }],
					details: { variantId: target.id, name: target.name },
				};
			}

			if (params.action === "delete") {
				const target = variants.find((v) => v.name === params.name || v.id === params.name);
				if (!target) throw new Error(`未找到名为「${params.name}」的方案。`);
				repo.deleteVariant(target.id);
				const updatedSnap = repo.getStudioSnapshot(sessionId, room.id);
				callbacks.onSceneSync?.(updatedSnap);
				return {
					content: [{ type: "text", text: `已删除方案「${target.name}」。` }],
					details: { deleted: target.name },
				};
			}

			// compare
			const varA = variants.find((v) => v.name === params.name || v.id === params.name);
			const varB = variants.find((v) => v.name === params.compareWith || v.id === params.compareWith);
			if (!varA || !varB) {
				throw new Error(`对比失败：请确保「${params.name}」和「${params.compareWith}」均已保存。`);
			}
			const diff = compareLayoutVariants(room.spec, varA, varB);
			return {
				content: [{ type: "text", text: JSON.stringify(diff) }],
				details: { variantA: varA.name, variantB: varB.name, movedCount: diff.movedCount },
			};
		},
	};

	return [
		getStudioContext,
		inspectLayoutConflicts,
		updateRoomDraft,
		commitRoomDraft,
		switchRoom,
		placeOrMoveFurniture,
		modifyFurniture,
		arrangeRoomStyle,
		manageLayoutVariant,
	];
}
