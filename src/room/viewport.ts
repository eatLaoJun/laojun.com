import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FURNITURE, ROOM, type RoomItem, type RoomSpec, type RoomView } from "./core/model";
import { createDraftPreview, createFurniture, createRoomShell, disposeScene, meters, roomX, roomZ } from "./scene";

type ViewportEvents = {
	select: (id: string | null) => void;
	dragStart: () => void;
	drag: (id: string, x: number, z: number) => void;
	dragEnd: (cancelled: boolean) => void;
	contextLost: () => void;
};

export type RoomViewport = {
	setRoom: (room: RoomSpec, draftPreview?: RoomSpec | null) => void;
	update: (items: RoomItem[], selected: string | null, warning: boolean) => void;
	view: (view: RoomView) => void;
	turn: (steps: -1 | 1) => void;
	frame: () => void;
	zoom: (factor: number) => void;
	dispose: () => void;
};

export function mountViewport(canvas: HTMLCanvasElement, events: ViewportEvents, initialRoom: RoomSpec = ROOM): RoomViewport {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setClearColor(0x000000, 0);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.04;

	const scene = new THREE.Scene();
	let activeRoom: RoomSpec = initialRoom;
	let shell = createRoomShell(activeRoom);
	let draftGroup: THREE.Group | undefined;
	const furnishings = new THREE.Group();
	const itemsById = new Map<string, RoomItem>();
	const meshes = new Map<string, THREE.Group>();

	// Refined selection halo: translucent pad + crisp architectural border
	const selectionGroup = new THREE.Group();
	const selectionPad = new THREE.Mesh(
		new THREE.PlaneGeometry(1, 1),
		new THREE.MeshBasicMaterial({ color: 0x2853a1, transparent: true, opacity: 0.14, depthWrite: false }),
	);
	selectionPad.rotation.x = -Math.PI / 2;
	const outline = new THREE.LineLoop(
		new THREE.BufferGeometry(),
		new THREE.LineBasicMaterial({ color: 0x2853a1 }),
	);
	selectionGroup.add(selectionPad, outline);
	selectionGroup.visible = false;
	scene.add(shell.group, furnishings, selectionGroup);

	// Clean natural gallery daylight rig harmonized with crisp white backdrop
	const sky = new THREE.HemisphereLight(0xffffff, 0xdce3ee, 1.42);
	const sun = new THREE.DirectionalLight(0xfffcf5, 1.95);
	sun.position.set(-4.6, 7.2, 3.2);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 0.5, far: 22 });
	sun.shadow.camera.updateProjectionMatrix();
	sun.shadow.normalBias = 0.018;
	sun.shadow.bias = -0.00015;
	sun.shadow.radius = 4;

	const fill = new THREE.DirectionalLight(0xe4eeff, 0.56);
	fill.position.set(4.5, 4.2, -3.5);
	scene.add(sky, sun, fill);

	const cameras = {
		plan: new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 80),
		room: new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 80),
	};
	const roomFocusHeight = 0.72;
	const targets = { plan: new THREE.Vector3(), room: new THREE.Vector3(0, roomFocusHeight, 0) };
	cameras.plan.position.set(0, 11, 0.00001);
	cameras.room.position.set(7.4, 7.8, 9.2);
	let mode: RoomView = "room";
	let controls: OrbitControls | undefined;
	let scheduledRender = 0;
	let disposed = false;
	let orbit: { targetAngle: number; from: THREE.Spherical; delta: number; started: number } | undefined;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

	const scheduleRender = (): void => {
		if (scheduledRender || disposed) return;
		scheduledRender = window.requestAnimationFrame((now) => {
			scheduledRender = 0;
			if (orbit && controls) {
				const t = THREE.MathUtils.clamp((now - orbit.started) / 260, 0, 1);
				const { radius, phi, theta } = orbit.from;
				cameras.room.position.setFromSphericalCoords(radius, phi, theta + orbit.delta * (1 - (1 - t) ** 3))
					.add(controls.target);
				if (t < 1) scheduleRender();
				else orbit = undefined;
			}
			controls?.update();
			const cutaway = mode === "room";
			const azimuth = controls?.getAzimuthalAngle() ?? 0;
			const towardEast = Math.sin(azimuth);
			const towardSouth = Math.cos(azimuth);
			sun.castShadow = cutaway;
			shell.bathroomWalls.visible = cutaway;
			shell.planLabels.visible = !cutaway;
			shell.walls.north.visible = cutaway && towardSouth > 0.11;
			shell.walls.south.visible = cutaway && towardSouth < -0.11;
			shell.walls.west.visible = cutaway && towardEast > 0.11;
			shell.walls.east.visible = cutaway && towardEast < -0.11;
			renderer.render(scene, cameras[mode]);
		});
	};

	const setControls = (): void => {
		controls?.dispose();
		const next = new OrbitControls(cameras[mode], canvas);
		next.target.copy(targets[mode]);
		next.enableDamping = true;
		next.dampingFactor = 0.12;
		next.enableRotate = mode === "room";
		next.minPolarAngle = 0.16;
		next.maxPolarAngle = Math.PI / 2 - 0.13;
		next.minZoom = 0.52;
		next.maxZoom = 3.5;
		next.zoomToCursor = true;
		next.mouseButtons.LEFT = THREE.MOUSE.PAN;
		next.mouseButtons.RIGHT = mode === "room" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
		next.touches.ONE = mode === "room" ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
		next.touches.TWO = THREE.TOUCH.DOLLY_PAN;
		if (mode === "plan") next.minPolarAngle = 0;
		next.addEventListener("change", scheduleRender);
		next.addEventListener("start", cancelOrbit);
		controls = next;
		next.update();
	};
	setControls();

	function resize(): void {
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (!width || !height) return;
		const aspect = width / height;
		const roomDiagonal = Math.hypot(meters(activeRoom.width), meters(activeRoom.depth));
		for (const key of ["plan", "room"] as const) {
			const camera = cameras[key];
			const pad = width >= 1024 ? 1.24 : 1.04;
			const span = key === "plan"
				? Math.max((meters(activeRoom.depth) + 1.5) * pad, ((meters(activeRoom.width) + 1.3) * pad) / aspect)
				: Math.max(roomDiagonal * 0.96 * pad, ((roomDiagonal + 1.2) * pad) / aspect);
			camera.left = -span * aspect / 2;
			camera.right = span * aspect / 2;
			camera.top = span / 2;
			camera.bottom = -span / 2;
			camera.updateProjectionMatrix();
		}
		renderer.setSize(width, height, false);
		scheduleRender();
	}
	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const point = new THREE.Vector3();
	let drag: { pointerId: number; id: string; screenX: number; screenY: number; offsetX: number; offsetZ: number; started: boolean } | undefined;

	function cancelOrbit(): void {
		if (!orbit) return;
		orbit = undefined;
		scheduleRender();
	}

	function turn(steps: -1 | 1): void {
		if (mode !== "room" || !controls || drag) return;
		const from = new THREE.Spherical().setFromVector3(cameras.room.position.clone().sub(controls.target));
		const targetAngle = (orbit?.targetAngle ?? from.theta) + steps * Math.PI / 4;
		const delta = THREE.MathUtils.euclideanModulo(targetAngle - from.theta + Math.PI, 2 * Math.PI) - Math.PI;
		targets.room.copy(controls.target);
		setControls();
		if (reducedMotion.matches || Math.abs(delta) < 0.001) {
			orbit = undefined;
			cameras.room.position.setFromSphericalCoords(from.radius, from.phi, from.theta + delta).add(targets.room);
			controls.update();
		} else {
			orbit = { targetAngle, from, delta, started: performance.now() };
		}
		scheduleRender();
	}

	function pointRay(event: PointerEvent): void {
		const bounds = canvas.getBoundingClientRect();
		pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
		cameras[mode].updateMatrixWorld();
		raycaster.setFromCamera(pointer, cameras[mode]);
	}
	function pointerDown(event: PointerEvent): void {
		if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || drag || !event.isPrimary) return;
		cancelOrbit();
		pointRay(event);
		furnishings.updateMatrixWorld(true);
		let node: THREE.Object3D | null = raycaster.intersectObjects(furnishings.children, true)[0]?.object ?? null;
		while (node?.parent && node.parent !== furnishings) node = node.parent;
		const item = node ? itemsById.get(node.name) : undefined;
		if (!item || !raycaster.ray.intersectPlane(floor, point)) {
			events.select(null);
			return;
		}
		if (controls) controls.enabled = false;
		canvas.setPointerCapture(event.pointerId);
		canvas.dataset.dragging = "";
		drag = {
			pointerId: event.pointerId, id: item.id, screenX: event.clientX, screenY: event.clientY,
			offsetX: item.x - (point.x * 100 + activeRoom.width / 2), offsetZ: item.z - (point.z * 100 + activeRoom.depth / 2),
			started: false,
		};
		events.select(item.id);
		events.dragStart();
	}
	function pointerMove(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (!drag.started && Math.hypot(event.clientX - drag.screenX, event.clientY - drag.screenY) < 3) return;
		drag.started = true;
		pointRay(event);
		if (raycaster.ray.intersectPlane(floor, point)) {
			events.drag(drag.id, point.x * 100 + activeRoom.width / 2 + drag.offsetX, point.z * 100 + activeRoom.depth / 2 + drag.offsetZ);
		}
	}
	function pointerEnd(event: PointerEvent): void {
		if (drag?.pointerId !== event.pointerId) return;
		drag = undefined;
		delete canvas.dataset.dragging;
		if (controls) controls.enabled = true;
		events.dragEnd(event.type !== "pointerup");
	}
	const listeners = new AbortController();
	const { signal } = listeners;
	canvas.addEventListener("pointerdown", pointerDown, { capture: true, signal });
	canvas.addEventListener("pointermove", pointerMove, { signal });
	canvas.addEventListener("pointerup", pointerEnd, { signal });
	canvas.addEventListener("pointercancel", pointerEnd, { signal });
	canvas.addEventListener("lostpointercapture", pointerEnd, { signal });
	canvas.addEventListener("webglcontextlost", events.contextLost, { signal });

	return {
		setRoom(room, draftPreview = null) {
			const changed = room.id !== activeRoom.id
				|| room.width !== activeRoom.width
				|| room.depth !== activeRoom.depth
				|| room.height !== activeRoom.height
				|| JSON.stringify(room.bathroom) !== JSON.stringify(activeRoom.bathroom);
			if (changed) {
				activeRoom = room;
				scene.remove(shell.group);
				disposeScene(shell.group);
				shell = createRoomShell(activeRoom);
				scene.add(shell.group);
				resize();
			}
			if (draftGroup) {
				scene.remove(draftGroup);
				disposeScene(draftGroup);
				draftGroup = undefined;
			}
			if (draftPreview) {
				draftGroup = createDraftPreview(draftPreview);
				scene.add(draftGroup);
			}
			scheduleRender();
		},
		update(items, selected, warning) {
			itemsById.clear();
			for (const item of items) {
				itemsById.set(item.id, item);
				let group = meshes.get(item.id);
				if (!group) {
					group = createFurniture(item.kind);
					group.name = item.id;
					meshes.set(item.id, group);
					furnishings.add(group);
				}
				group.position.set(roomX(item.x, activeRoom), 0, roomZ(item.z, activeRoom));
				group.rotation.y = -THREE.MathUtils.degToRad(item.rotation);
			}
			for (const [id, group] of meshes) {
				if (itemsById.has(id)) continue;
				furnishings.remove(group);
				disposeScene(group);
				meshes.delete(id);
			}
			const item = selected ? itemsById.get(selected) : undefined;
			selectionGroup.visible = Boolean(item);
			if (item) {
				const { width, depth } = FURNITURE[item.kind];
				const x = meters(width / 2 + 6);
				const z = meters(depth / 2 + 6);
				const geometry = new THREE.BufferGeometry().setFromPoints([
					new THREE.Vector3(-x, 0.002, -z), new THREE.Vector3(x, 0.002, -z),
					new THREE.Vector3(x, 0.002, z), new THREE.Vector3(-x, 0.002, z),
				]);
				outline.geometry.dispose();
				outline.geometry = geometry;
				const accentHex = warning ? 0xc25555 : 0x2853a1;
				outline.material.color.setHex(accentHex);
				selectionPad.material.color.setHex(warning ? 0xc25555 : 0x2853a1);
				selectionPad.scale.set(x * 2, z * 2, 1);
				selectionGroup.position.set(roomX(item.x, activeRoom), 0.024, roomZ(item.z, activeRoom));
				selectionGroup.rotation.y = -THREE.MathUtils.degToRad(item.rotation);
			}
			scheduleRender();
		},
		view(view) {
			if (view === mode) return;
			cancelOrbit();
			if (controls) targets[mode].copy(controls.target);
			mode = view;
			setControls();
			scheduleRender();
		},
		turn,
		frame() {
			cancelOrbit();
			if (mode === "room") {
				cameras.room.position.set(7.4, 7.8, 9.2);
				targets.room.set(0, roomFocusHeight, 0);
			} else {
				cameras.plan.position.set(0, 11, 0.00001);
				targets.plan.set(0, 0, 0);
			}
			cameras[mode].zoom = 1;
			cameras[mode].updateProjectionMatrix();
			setControls();
			scheduleRender();
		},
		zoom(factor) {
			cameras[mode].zoom = THREE.MathUtils.clamp(cameras[mode].zoom * factor, 0.52, 3.5);
			cameras[mode].updateProjectionMatrix();
			scheduleRender();
		},
		dispose() {
			disposed = true;
			if (scheduledRender) cancelAnimationFrame(scheduledRender);
			listeners.abort();
			observer.disconnect();
			controls?.dispose();
			disposeScene(scene);
			sun.shadow.dispose();
			renderer.dispose();
		},
	};
}
