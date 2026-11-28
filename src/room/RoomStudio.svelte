<script lang="ts">
	import { onMount } from "svelte";
	import {
		CATALOG,
		FURNITURE,
		ROOM,
		fitToRoom,
		initialLayout,
		layoutWarning,
		nextPlacement,
		restoreLayout,
		type FurnitureKind,
		type LayoutVariant,
		type RoomDraft,
		type RoomItem,
		type RoomSpec,
		type RoomView,
	} from "./core/model";
	import {
		activateRoomApi,
		applyVariantApi,
		deleteVariantApi,
		fetchStudioState,
		saveRoomLayoutApi,
		saveVariantApi,
		type ChatMessageDTO,
		type RoomRecordDTO,
		type StudioSnapshotDTO,
	} from "./api";
	import AgentDrawer from "./AgentDrawer.svelte";
	import type { RoomViewport } from "./viewport";
	import "./studio.css";

	let { home }: { home: string } = $props();

	const warningText = {
		door: "家具占用了入户门的开启空间。",
		passage: "家具有一部分占用了入户过道。",
		overlap: "家具与其他物件的占地范围重叠。",
	};
	const swatchColor: Record<FurnitureKind, string> = {
		bed: "#8a9b7c",
		desk: "#d2b38c",
		chair: "#c47b5a",
		sofa: "#7c8e6e",
		cabinet: "#b5885e",
		plant: "#5e7d52",
		lamp: "#c9a44c",
		rug: "#cc7b59",
	};

	let canvas: HTMLCanvasElement;
	let viewport = $state.raw<RoomViewport>();
	let rooms = $state.raw<RoomRecordDTO[]>([
		{ id: ROOM.id, name: ROOM.name, spec: ROOM, items: initialLayout(), createdAt: 0, updatedAt: 0 },
	]);
	let activeRoom = $state.raw<RoomSpec>(ROOM);
	let items = $state.raw<RoomItem[]>(initialLayout());
	let variants = $state.raw<LayoutVariant[]>([]);
	let draft = $state.raw<RoomDraft | null>(null);
	let chatMessages = $state<ChatMessageDTO[]>([]);
	let chatChanged = false;
	let backendOnline = $state(false);

	let history = $state.raw<RoomItem[][]>([]);
	let selected = $state<string | null>(null);
	let view = $state<RoomView>("room");
	let renderer = $state<"loading" | "ready" | "unavailable">("loading");
	let notice = $state("");
	let dragSnapshot: RoomItem[] | undefined;

	const storageKey = $derived(`laojun-room-layout:${activeRoom.id}:v1`);
	const roomDimensions = $derived(`${(activeRoom.width / 100).toFixed(2)} × ${(activeRoom.depth / 100).toFixed(2)} m`);
	const roomArea = $derived((activeRoom.width * activeRoom.depth / 10000).toFixed(1));
	const bathroomDimensions = $derived(
		activeRoom.bathroom
			? `${(activeRoom.bathroom.width / 100).toFixed(2)} × ${(activeRoom.bathroom.depth / 100).toFixed(2)} m`
			: "无",
	);
	const active = $derived(items.find((item) => item.id === selected));
	const warning = $derived(active && layoutWarning(active, items, activeRoom));

	$effect(() => viewport?.setRoom(activeRoom, draft?.valid ? draft.spec ?? null : null));
	$effect(() => viewport?.update(items, selected, Boolean(warning)));
	$effect(() => viewport?.view(view));

	function applySnapshot(snapshot: StudioSnapshotDTO, keepHistory = false): void {
		const prevRoomId = activeRoom.id;
		rooms = snapshot.rooms;
		activeRoom = snapshot.activeRoom.spec;
		items = snapshot.activeRoom.items;
		variants = snapshot.variants;
		draft = snapshot.draft;
		if (prevRoomId !== snapshot.activeRoom.id) {
			selected = null;
			history = [];
			viewport?.frame();
		} else if (!keepHistory && !items.some((it) => it.id === selected)) {
			selected = null;
		}
	}

	function updateChatMessages(messages: ChatMessageDTO[]): void {
		chatChanged = true;
		chatMessages = messages;
	}

	onMount(() => {
		let stopped = false;
		let instance: RoomViewport | undefined;

		// Load persisted rooms & chat from SQLite backend, fallback to localStorage if offline
		void fetchStudioState().then((data) => {
			if (stopped) return;
			if (data) {
				backendOnline = true;
				applySnapshot(data.snapshot);
				// The initial fetch can finish after the user has already started chatting.
				if (!chatChanged) chatMessages = data.messages;
			} else {
				try {
					const saved = localStorage.getItem(`laojun-room-layout:${ROOM.id}:v1`);
					if (saved) items = restoreLayout(JSON.parse(saved), ROOM) ?? items;
				} catch {
					// Ignore storage errors
				}
			}
		});

		const onGraphicsUnavailable = (): void => {
			if (stopped) return;
			endDrag(true);
			viewport = undefined;
			renderer = "unavailable";
			view = "plan";
		};
		void import("./viewport").then(({ mountViewport }) => {
			if (stopped) return;
			instance = mountViewport(canvas, {
				select: (id) => { selected = id; },
				dragStart: () => { dragSnapshot = items; },
				drag: (id, x, z) => move(id, x, z, true),
				dragEnd: endDrag,
				contextLost: () => { instance?.dispose(); instance = undefined; onGraphicsUnavailable(); },
			}, activeRoom);
			viewport = instance;
			renderer = "ready";
		}).catch(onGraphicsUnavailable);
		return () => { stopped = true; instance?.dispose(); };
	});

	function save(): void {
		try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* ignore */ }
		if (backendOnline) {
			void saveRoomLayoutApi(activeRoom.id, items);
		}
	}

	function record(previous: RoomItem[]): void {
		history = [...history.slice(-29), previous];
		save();
	}

	function commit(next: RoomItem[]): void {
		const previous = items;
		items = next;
		record(previous);
	}

	function endDrag(cancelled: boolean): void {
		const previous = dragSnapshot;
		dragSnapshot = undefined;
		if (!previous || items === previous) return;
		if (cancelled) items = previous;
		else if (items.some((item, i) => item.x !== previous[i]?.x || item.z !== previous[i]?.z)) record(previous);
	}

	function move(id: string, x: number, z: number, preview = false): void {
		if (!Number.isFinite(x) || !Number.isFinite(z)) return;
		const item = items.find((placed) => placed.id === id);
		if (!item) return;
		const updated = fitToRoom({ ...item, x, z }, activeRoom);
		if (item.x === updated.x && item.z === updated.z) return;
		const next = items.map((placed) => placed.id === id ? updated : placed);
		if (preview) items = next;
		else commit(next);
	}

	function append(kind: FurnitureKind): void {
		if (items.length >= 40) { notice = "已达到当前房间的家具数量上限。"; return; }
		let number = 1;
		while (items.some((item) => item.id === `${kind}-${number}`)) number++;
		const item = nextPlacement(kind, `${kind}-${number}`, items, activeRoom);
		if (!item) { notice = "没有合适的空位，请先挪开或移除家具。"; return; }
		commit([...items, item]);
		selected = item.id;
		notice = `已添加${FURNITURE[kind].label}。`;
	}

	function rotate(reverse = false): void {
		if (!active) return;
		const changed = fitToRoom({ ...active, rotation: active.rotation + (reverse ? -90 : 90) }, activeRoom);
		commit(items.map((item) => item.id === changed.id ? changed : item));
	}

	function remove(): void {
		if (!active) return;
		notice = `已移除${FURNITURE[active.kind].label}。`;
		commit(items.filter((item) => item.id !== selected));
		selected = null;
	}

	function undo(): void {
		const previous = history.at(-1);
		if (!previous) return;
		items = previous;
		history = history.slice(0, -1);
		if (!items.some((item) => item.id === selected)) selected = null;
		notice = "已撤销上一步。";
		save();
	}

	function resetLayout(): void {
		const next = activeRoom.id === ROOM.id ? initialLayout() : [];
		commit(next);
		selected = null;
		notice = "已恢复初始家具布局。";
		viewport?.frame();
	}

	async function switchRoom(roomId: string): Promise<void> {
		if (roomId === activeRoom.id) return;
		if (backendOnline) {
			const snap = await activateRoomApi(roomId);
			if (snap) {
				applySnapshot(snap);
				notice = `已切换至「${snap.activeRoom.name}」`;
				return;
			}
		}
		const target = rooms.find((r) => r.id === roomId);
		if (target) {
			activeRoom = target.spec;
			items = target.items;
			selected = null;
			history = [];
			viewport?.frame();
		}
	}

	async function handleSaveVariant(): Promise<void> {
		const name = `方案 ${variants.length + 1}`;
		if (backendOnline) {
			const updated = await saveVariantApi(activeRoom.id, name, items, "custom");
			if (updated) {
				variants = updated;
				notice = `已保存布局快照「${name}」`;
				return;
			}
		}
		variants = [...variants, { id: `local-${Date.now()}`, roomId: activeRoom.id, name, style: "custom", items: [...items], createdAt: Date.now() }];
		notice = `已暂存布局快照「${name}」`;
	}

	async function handleApplyVariant(variant: LayoutVariant): Promise<void> {
		const prev = items;
		if (backendOnline) {
			const snap = await applyVariantApi(activeRoom.id, variant.id);
			if (snap) {
				history = [...history.slice(-29), prev];
				applySnapshot(snap, true);
				notice = `已切换到方案「${variant.name}」`;
				return;
			}
		}
		commit(variant.items);
		notice = `已切换到方案「${variant.name}」`;
	}

	async function handleDeleteVariant(variant: LayoutVariant): Promise<void> {
		if (backendOnline) {
			const updated = await deleteVariantApi(activeRoom.id, variant.id);
			if (updated) variants = updated;
		} else {
			variants = variants.filter((v) => v.id !== variant.id);
		}
		notice = `已删除方案「${variant.name}」`;
	}

	function updateCoordinate(axis: "x" | "z", field: HTMLInputElement): void {
		if (!active) return;
		const value = field.valueAsNumber;
		move(active.id, axis === "x" ? value : active.x, axis === "z" ? value : active.z);
		const item = items.find((placed) => placed.id === active?.id);
		if (item) field.value = String(item[axis]);
	}

	function shortcut(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		if (key === "z" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
			event.preventDefault();
			undo();
			return;
		}
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (key === "0") viewport?.frame();
		if (key === "1") view = "plan";
		if (key === "2") view = "room";
		if (key === "r") rotate(event.shiftKey);
		if (key === "delete") remove();
		if (key === "escape") selected = null;
		if (active && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
			const dz = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
			move(active.id, active.x + dx, active.z + dz);
		}
	}
</script>

{#snippet furnitureThumb(kind: FurnitureKind)}
	<svg class="thumb-svg" viewBox="0 0 64 48" aria-hidden="true">
		{#if kind === "bed"}
			<rect x="12" y="8" width="40" height="12" rx="3" fill="#c6a177" />
			<rect x="10" y="16" width="44" height="24" rx="4" fill="#d9c4a3" />
			<rect x="13" y="18" width="38" height="20" rx="3" fill="#f7f3eb" />
			<rect x="16" y="19" width="14" height="7" rx="2.5" fill="#e6dccb" />
			<rect x="34" y="19" width="14" height="7" rx="2.5" fill="#e6dccb" />
			<rect x="12" y="25" width="40" height="14" rx="2.5" fill="#8a9b7c" />
			<rect x="12" y="33" width="40" height="5" rx="1.5" fill="#c9a44c" />
		{:else if kind === "desk"}
			<rect x="12" y="24" width="3.5" height="16" rx="1" fill="#8b6749" />
			<rect x="48.5" y="24" width="3.5" height="16" rx="1" fill="#8b6749" />
			<rect x="36" y="24" width="13" height="8" rx="1.5" fill="#b88b61" />
			<rect x="40" y="27.5" width="5" height="1.4" rx="0.7" fill="#c9a44c" />
			<rect x="9" y="21" width="46" height="4" rx="1.5" fill="#d9b991" />
			<rect x="20" y="10" width="18" height="10" rx="1.5" fill="#3e3a36" />
			<rect x="21.5" y="11.5" width="15" height="7" rx="0.8" fill="#dfe9e2" />
			<rect x="28" y="19.5" width="2" height="2" fill="#b4afa6" />
			<rect x="43" y="17" width="4" height="4" rx="1" fill="#c46a4a" />
		{:else if kind === "chair"}
			<rect x="21" y="27" width="3" height="13" rx="1" fill="#8b6749" />
			<rect x="40" y="27" width="3" height="13" rx="1" fill="#8b6749" />
			<rect x="22" y="11" width="20" height="12" rx="4" fill="#c47b5a" />
			<rect x="18" y="24" width="28" height="5" rx="2.2" fill="#d08867" />
			<rect x="20" y="28" width="24" height="2.2" rx="1" fill="#d2b38c" />
		{:else if kind === "sofa"}
			<rect x="14" y="34" width="3" height="6" rx="1" fill="#7c5a40" />
			<rect x="47" y="34" width="3" height="6" rx="1" fill="#7c5a40" />
			<rect x="12" y="14" width="40" height="15" rx="5" fill="#7c8e6e" />
			<rect x="8" y="20" width="8" height="15" rx="3.5" fill="#6f8161" />
			<rect x="48" y="20" width="8" height="15" rx="3.5" fill="#6f8161" />
			<rect x="15" y="25" width="16.5" height="7" rx="3" fill="#8fa280" />
			<rect x="32.5" y="25" width="16.5" height="7" rx="3" fill="#8fa280" />
			<rect x="11" y="31" width="42" height="4.5" rx="2" fill="#748666" />
			<rect x="17" y="19" width="7" height="6.5" rx="2" fill="#f0e7d6" />
			<rect x="40" y="19" width="7" height="6.5" rx="2" fill="#dfba73" />
		{:else if kind === "cabinet"}
			<rect x="15" y="34" width="3" height="6" rx="1" fill="#7c5a40" />
			<rect x="46" y="34" width="3" height="6" rx="1" fill="#7c5a40" />
			<rect x="11" y="18" width="42" height="17" rx="2.5" fill="#d2b38c" />
			<rect x="14" y="21" width="17" height="11" rx="1.2" fill="#b5885e" />
			<rect x="33" y="21" width="17" height="11" rx="1.2" fill="#b5885e" />
			<rect x="28.5" y="24.5" width="1.4" height="4.5" rx="0.7" fill="#c9a44c" />
			<rect x="34.1" y="24.5" width="1.4" height="4.5" rx="0.7" fill="#c9a44c" />
			<ellipse cx="22" cy="14" rx="3.2" ry="4" fill="#efe8db" />
			<rect x="36" y="15.5" width="10" height="2.5" rx="0.8" fill="#8a9b7c" />
		{:else if kind === "plant"}
			<path d="M23 27h18l-2.5 13h-13z" fill="#c46a4a" />
			<rect x="21.5" y="25.5" width="21" height="3" rx="1.5" fill="#d27958" />
			<ellipse cx="26" cy="18" rx="6" ry="8" transform="rotate(-24 26 18)" fill="#5e7d52" />
			<ellipse cx="38" cy="18" rx="6" ry="8" transform="rotate(24 38 18)" fill="#6f8f5f" />
			<ellipse cx="32" cy="14" rx="5.5" ry="9" fill="#4f6d47" />
		{:else if kind === "lamp"}
			<ellipse cx="32" cy="39" rx="9" ry="2.5" fill="#dfd5c6" />
			<rect x="31" y="18" width="2" height="21" fill="#c9a44c" />
			<path d="M24 9h16l3.5 11h-23z" fill="#f7e7c4" stroke="#d9c297" stroke-width="1" />
			<ellipse cx="32" cy="20" rx="10" ry="2" fill="#ffdf9e" opacity="0.7" />
		{:else}
			<rect x="11" y="10" width="42" height="28" rx="2.5" fill="#cc7b59" />
			<rect x="15" y="14" width="34" height="20" rx="1" fill="none" stroke="#f0e3ce" stroke-width="1.5" opacity="0.8" />
			<rect x="18" y="17" width="28" height="14" rx="0.5" fill="none" stroke="#8a472c" stroke-width="0.9" opacity="0.45" />
		{/if}
	</svg>
{/snippet}

<div class="room-studio">
	<!-- Full-bleed interactive canvas stage -->
	<div class="studio-stage">
		<canvas bind:this={canvas} class="studio-canvas" hidden={renderer === "unavailable"}
			tabindex="0" onkeydown={shortcut} aria-label="房间布置画布" aria-describedby="studio-controls"></canvas>
		{#if renderer === "loading"}
			<div class="studio-loading" aria-live="polite">
				<p class="studio-loading-title">Room Studio</p>
				<p class="studio-loading-sub">正在布置光影与空间…</p>
			</div>
		{:else if renderer === "unavailable"}
			<svg class="studio-fallback" viewBox={`-25 -25 ${activeRoom.width + 50} ${activeRoom.depth + 50}`} role="img" aria-label="房间平面布局">
				<rect width={activeRoom.width} height={activeRoom.depth} rx="6" fill="#e4d2b8" stroke="#9fb0c7" stroke-width="7" />
				{#if activeRoom.bathroom}
					<rect x={activeRoom.bathroom.x} y={activeRoom.bathroom.z} width={activeRoom.bathroom.width} height={activeRoom.bathroom.depth} fill="#edf0f5" />
					<text x={activeRoom.bathroom.x + activeRoom.bathroom.width / 2} y={activeRoom.bathroom.z + activeRoom.bathroom.depth / 2} text-anchor="middle" font-size="15" fill="#101a2a">卫生间</text>
				{/if}
				{#if activeRoom.passage}
					<rect x={activeRoom.passage.x} y={activeRoom.passage.z} width={activeRoom.passage.width} height={activeRoom.passage.depth} fill="#e6eef9" opacity="0.6" />
				{/if}
				{#each [...items].sort((a, b) => Number(b.kind === "rug") - Number(a.kind === "rug")) as item (item.id)}
					<g transform={`translate(${item.x} ${item.z})`}>
						<rect x={-FURNITURE[item.kind].width / 2} y={-FURNITURE[item.kind].depth / 2}
							width={FURNITURE[item.kind].width} height={FURNITURE[item.kind].depth}
							transform={`rotate(${item.rotation})`} rx="6" fill={swatchColor[item.kind]}
							stroke={selected === item.id ? "#2853a1" : "#ffffff"} stroke-width="3" />
						<text text-anchor="middle" dominant-baseline="middle" font-size="13" fill="#ffffff">{FURNITURE[item.kind].label}</text>
					</g>
				{/each}
			</svg>
		{/if}
	</div>

	<!-- Floating Top Chrome Bar -->
	<header class="studio-topbar glass">
		<div class="topbar-left">
			<a class="studio-brand" href={home} title="返回 LaoJun 首页">
				<span class="brand-mark" aria-hidden="true"></span>
				<span>LaoJun</span>
			</a>
			<span class="topbar-divider" aria-hidden="true"></span>
			{#if rooms.length > 1}
				<label class="room-select-wrap">
					<span class="sr-only">切换房间</span>
					<select class="room-select" value={activeRoom.id} onchange={(e) => void switchRoom(e.currentTarget.value)}>
						{#each rooms as r (r.id)}
							<option value={r.id}>{r.name} · {((r.spec.width * r.spec.depth) / 10000).toFixed(1)} m²</option>
						{/each}
					</select>
				</label>
			{:else}
				<div class="room-pill">
					<h1 id="studio-title">{activeRoom.name}</h1>
					<span class="room-pill-meta">{roomArea} m²</span>
				</div>
			{/if}
			{#if backendOnline}
				<span class="sync-badge" title="已连接 SQLite 后端与 PiAgent">SQLite</span>
			{/if}
		</div>

		<div class="topbar-right">
			<div class="segmented" role="group" aria-label="切换房间视图">
				<button type="button" aria-pressed={view === "plan"} onclick={() => { view = "plan"; }} title="2D 平面视图 (快捷键 1)">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 13h9v7M13 4v9h7" /></svg>
					<span>2D</span>
				</button>
				<button type="button" aria-pressed={view === "room"} disabled={renderer === "unavailable"} onclick={() => { view = "room"; }} title="3D 立体视图 (快捷键 2)">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 9 8-4.5M12 12v9m0-9L4 7.5" /></svg>
					<span>3D</span>
				</button>
			</div>

			{#if renderer === "ready"}
				<div class="toolbar-group" role="group" aria-label="视角与相机控制">
					{#if view === "room"}
						<button type="button" class="icon-btn" title="向左转 45°" aria-label="向左转 45 度" onclick={() => viewport?.turn(-1)}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.3 6.2M4 5v6h6" /></svg>
						</button>
						<button type="button" class="icon-btn" title="向右转 45°" aria-label="向右转 45 度" onclick={() => viewport?.turn(1)}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.2M20 5v6h-6" /></svg>
						</button>
						<span class="group-sep" aria-hidden="true"></span>
					{/if}
					<button type="button" class="icon-btn" title="缩小" aria-label="缩小" onclick={() => viewport?.zoom(1 / 1.18)}>−</button>
					<button type="button" class="icon-btn" title="放大" aria-label="放大" onclick={() => viewport?.zoom(1.18)}>+</button>
					<button type="button" class="icon-btn" title="复位视角 (快捷键 0)" aria-label="复位视角" onclick={() => viewport?.frame()}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /><circle cx="12" cy="12" r="2.6" /></svg>
					</button>
				</div>
			{/if}

			<div class="toolbar-group" role="group" aria-label="布局操作">
				<button type="button" class="icon-btn" title="撤销上一步 (Ctrl+Z)" aria-label="撤销" disabled={!history.length} onclick={undo}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
				</button>
				<button type="button" class="text-btn" onclick={resetLayout}>恢复初始</button>
			</div>
		</div>
	</header>

	<!-- Floating Left Panel: Furniture Catalog -->
	<aside class="studio-rail rail-left glass" aria-labelledby="catalog-title">
		<div class="panel-header">
			<span id="catalog-title" class="panel-kicker">CATALOG · 家具库</span>
			<span class="panel-count">{CATALOG.length} 种</span>
		</div>
		<div class="catalog-list panel-scroll">
			{#each CATALOG as kind (kind)}
				{@const piece = FURNITURE[kind]}
				<button type="button" class="catalog-card" onclick={() => append(kind)} aria-label={`添加${piece.label}`}>
					<div class="catalog-thumb">
						{@render furnitureThumb(kind)}
					</div>
					<div class="catalog-info">
						<div class="catalog-name-row">
							<strong>{piece.label}</strong>
							<span class="swatch-dot" style:--swatch={swatchColor[kind]}></span>
						</div>
						<span class="catalog-dims">{piece.width} × {piece.depth} cm</span>
					</div>
					<span class="catalog-add" aria-hidden="true">+</span>
				</button>
			{/each}
		</div>
	</aside>

	<!-- Floating Right Column: Inspector + Variants + Current Layout -->
	<aside class="studio-rail rail-right" aria-label="属性与布局清单">
		<section class="glass inspector-card" aria-labelledby="inspector-title">
			<div class="panel-header">
				<span id="inspector-title" class="panel-kicker">INSPECTOR · {active ? "已选家具" : "房间概览"}</span>
				{#if active}
					<button type="button" class="clear-btn" onclick={() => { selected = null; }}>取消选择</button>
				{/if}
			</div>

			{#if active}
				{@const piece = FURNITURE[active.kind]}
				<div class="inspector-selected">
					<div class="inspector-hero">
						<div class="catalog-thumb large">
							{@render furnitureThumb(active.kind)}
						</div>
						<div>
							<h2 class="inspector-name">{piece.label}</h2>
							<p class="inspector-sub">{active.id.toUpperCase()}</p>
							<p class="inspector-size">{piece.width} × {piece.depth} cm · {active.rotation}°</p>
						</div>
					</div>

					<div class="inspector-grid">
						<label class="coord-field">
							<span>横向 X (cm)</span>
							<input type="number" min="0" max={activeRoom.width} step="1" value={active.x} onchange={(e) => updateCoordinate("x", e.currentTarget)} />
						</label>
						<label class="coord-field">
							<span>纵向 Z (cm)</span>
							<input type="number" min="0" max={activeRoom.depth} step="1" value={active.z} onchange={(e) => updateCoordinate("z", e.currentTarget)} />
						</label>
					</div>

					{#if warning}
						<p class="inspector-warning" role="alert">{warningText[warning]}</p>
					{/if}

					<div class="inspector-actions">
						<button type="button" class="action-pill" onclick={() => rotate()}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" /></svg>
							旋转 90°
						</button>
						<button type="button" class="action-pill danger" onclick={remove}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
							移除
						</button>
					</div>
				</div>
			{:else}
				<div class="inspector-overview">
					<div class="overview-top">
						<div>
							<h2 class="overview-title">{activeRoom.name}</h2>
							<p class="overview-sub">{roomArea} m² · {items.length} 件家具</p>
						</div>
						<div class="overview-badge">{roomArea}<span>m²</span></div>
					</div>
					<dl class="overview-specs">
						<div><dt>外框尺寸</dt><dd>{roomDimensions}</dd></div>
						<div><dt>独立卫生间</dt><dd>{bathroomDimensions}</dd></div>
					</dl>
					{#if notice}
						<p class="overview-notice" role="status">{notice}</p>
					{/if}
				</div>
			{/if}
		</section>

		<section class="glass layout-card" aria-labelledby="layout-title">
			<div class="panel-header">
				<span id="layout-title" class="panel-kicker">LAYOUT · 方案与清单</span>
				<button type="button" class="clear-btn" onclick={() => void handleSaveVariant()}>+ 保存方案</button>
			</div>

			{#if variants.length > 0}
				<div class="variants-bar" aria-label="布局方案快照">
					{#each variants as v (v.id)}
						<div class="variant-chip">
							<button type="button" class="variant-load" onclick={() => void handleApplyVariant(v)} title={`切换到「${v.name}」`}>
								{v.name}
							</button>
							{#if variants.length > 1}
								<button type="button" class="variant-del" aria-label={`删除${v.name}`} onclick={() => void handleDeleteVariant(v)}>×</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if items.length}
				<ul class="layout-list panel-scroll" aria-label="已摆放的家具">
					{#each items as item (item.id)}
						<li>
							<button type="button" class="layout-row" aria-pressed={selected === item.id} onclick={() => { selected = item.id; }}>
								<span class="swatch-dot" style:--swatch={swatchColor[item.kind]}></span>
								<span class="layout-label">{FURNITURE[item.kind].label}</span>
								<span class="layout-pos">{item.x}, {item.z}</span>
								<span class="layout-id">{item.id.split("-").at(-1)?.padStart(2, "0")}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="layout-empty">房间还是空的，从左侧家具库或下方 PiAgent 添加家具吧。</p>
			{/if}
		</section>
	</aside>

	<!-- Bottom Floating PiAgent Prompt Bar & Clarify Drawer -->
	<AgentDrawer
		roomId={activeRoom.id}
		{draft}
		bind:messages={() => chatMessages, updateChatMessages}
		onDraftUpdated={(nextDraft) => { draft = nextDraft; }}
		onSceneSync={(snap) => applySnapshot(snap)}
		onNotice={(text) => { notice = text; }}
	/>

	<p id="studio-controls" class="sr-only">
		拖家具摆放，拖空白平移，右键拖动旋转，滚轮缩放，快捷键 1 和 2 切换 2D/3D 视图。
	</p>
</div>
