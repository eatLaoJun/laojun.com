import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FURNITURE, ROOM, isHorizontalWall, isMinWall, type FurnitureKind, type RoomSpec, type WallSide } from "./core/model";

export const meters = (cm: number): number => cm / 100;
export const roomX = (cm: number, room: RoomSpec = ROOM): number => meters(cm - room.width / 2);
export const roomZ = (cm: number, room: RoomSpec = ROOM): number => meters(cm - room.depth / 2);

const oak = 0xd2b38c;
const warmWood = 0xb5885e;
const walnut = 0x7c5a40;
const linen = 0xf5f6f8;
const plaster = 0xf4f6f9;
const plasterCap = 0xffffff;
const baseboard = 0xf9fafc;
const charcoal = 0x1e293b;
const brass = 0xc9a44c;
const ceramic = 0xffffff;

function matte(color: THREE.ColorRepresentation, roughness = 0.86): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function woodMat(color: THREE.ColorRepresentation, roughness = 0.66): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function metalMat(color: THREE.ColorRepresentation, roughness = 0.34, metalness = 0.72): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function ceramicMat(color: THREE.ColorRepresentation = ceramic): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({ color, roughness: 0.24, metalness: 0.04 });
}

function mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
	x: number, y: number, z: number, shadow = true): THREE.Mesh {
	const object = new THREE.Mesh(geometry, material);
	object.position.set(x, y, z);
	object.castShadow = shadow;
	object.receiveShadow = true;
	parent.add(object);
	return object;
}

function box(parent: THREE.Group, color: THREE.ColorRepresentation, w: number, h: number, d: number,
	x: number, y: number, z: number, shadow = true, roughness = 0.84): THREE.Mesh {
	return mesh(parent, new THREE.BoxGeometry(w, h, d), matte(color, roughness), x, y, z, shadow);
}

function rbox(parent: THREE.Group, material: THREE.Material, w: number, h: number, d: number,
	radius: number, x: number, y: number, z: number, shadow = true): THREE.Mesh {
	const safeRadius = Math.min(radius, w / 2.2, h / 2.2, d / 2.2);
	return mesh(parent, new RoundedBoxGeometry(w, h, d, 3, safeRadius), material, x, y, z, shadow);
}

function taperedLegs(group: THREE.Group, w: number, d: number, height: number,
	color: THREE.ColorRepresentation = walnut, inset = 0.075, topR = 0.024, botR = 0.015): void {
	const mat = woodMat(color, 0.62);
	for (const x of [-w / 2 + inset, w / 2 - inset]) {
		for (const z of [-d / 2 + inset, d / 2 - inset]) {
			mesh(group, new THREE.CylinderGeometry(topR, botR, height, 12), mat, x, height / 2, z);
		}
	}
}

function rugTexture(): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 448;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.fillStyle = "#cc7b59";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Subtle woven linen slub texture
		for (let y = 0; y < canvas.height; y += 4) {
			ctx.fillStyle = y % 8 === 0 ? "rgba(255, 245, 232, 0.08)" : "rgba(92, 46, 28, 0.06)";
			ctx.fillRect(0, y, canvas.width, 2);
		}
		for (let x = 0; x < canvas.width; x += 6) {
			ctx.fillStyle = x % 12 === 0 ? "rgba(255, 244, 226, 0.05)" : "rgba(80, 42, 26, 0.04)";
			ctx.fillRect(x, 0, 2, canvas.height);
		}

		// Architectural inset border lines
		ctx.strokeStyle = "rgba(244, 232, 214, 0.55)";
		ctx.lineWidth = 4;
		ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
		ctx.strokeStyle = "rgba(138, 71, 44, 0.35)";
		ctx.lineWidth = 2;
		ctx.strokeRect(34, 34, canvas.width - 68, canvas.height - 68);
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	return texture;
}

export function createFurniture(kind: FurnitureKind): THREE.Group {
	const group = new THREE.Group();
	const item = FURNITURE[kind];
	const w = meters(item.width);
	const d = meters(item.depth);
	switch (kind) {
		case "bed": {
			const oakMat = woodMat(oak, 0.64);
			const headMat = woodMat(warmWood, 0.68);
			const sheetMat = matte(0xf8f4ec, 0.9);
			const duvetMat = matte(0x8a9b7c, 0.92);
			const throwMat = matte(0xc9a44c, 0.94);
			const pillowMat = matte(0xfaf6ef, 0.92);
			const accentPillowMat = matte(0xd6bca0, 0.9);

			taperedLegs(group, w, d, 0.14, walnut, 0.08, 0.028, 0.018);
			// Rounded oak platform frame
			rbox(group, oakMat, w, 0.15, d, 0.025, 0, 0.21, 0);
			// Sculpted headboard with subtle inset panel
			rbox(group, oakMat, w + 0.02, 0.88, 0.08, 0.03, 0, 0.52, -d / 2 + 0.04);
			rbox(group, headMat, w - 0.12, 0.48, 0.025, 0.015, 0, 0.65, -d / 2 + 0.082, false);
			// Plush rounded mattress
			rbox(group, sheetMat, w - 0.09, 0.19, d - 0.13, 0.045, 0, 0.37, 0.025);
			// Folded sage duvet
			rbox(group, duvetMat, w - 0.04, 0.11, d * 0.66, 0.04, 0, 0.455, d * 0.145);
			// Crisp white folded top cuff of sheet
			rbox(group, sheetMat, w - 0.055, 0.045, 0.15, 0.02, 0, 0.495, -d * 0.15, false);
			// Woven ochre throw runner at the foot
			rbox(group, throwMat, w - 0.02, 0.06, 0.28, 0.025, 0, 0.485, d * 0.33);
			// Plump pillows & accent cushions
			for (const x of [-w * 0.23, w * 0.23]) {
				const pillow = rbox(group, pillowMat, w * 0.38, 0.13, 0.34, 0.055, x, 0.515, -d * 0.33);
				pillow.rotation.x = 0.16;
				const cushion = rbox(group, accentPillowMat, w * 0.25, 0.11, 0.19, 0.045, x, 0.525, -d * 0.205);
				cushion.rotation.x = 0.28;
			}
			break;
		}
		case "desk": {
			const topMat = woodMat(oak, 0.6);
			const drawerMat = woodMat(warmWood, 0.66);
			const legMat = woodMat(walnut, 0.64);
			const matPad = matte(0x525951, 0.92);
			const aluMat = metalMat(0xcac5bc, 0.3, 0.78);
			const screenMat = new THREE.MeshStandardMaterial({
				color: 0xe6efe9, emissive: 0xd8e5dc, emissiveIntensity: 0.28, roughness: 0.35,
			});

			// Tapered legs
			for (const x of [-w / 2 + 0.075, w / 2 - 0.075]) {
				for (const z of [-d / 2 + 0.065, d / 2 - 0.065]) {
					mesh(group, new THREE.CylinderGeometry(0.022, 0.015, 0.72, 12), legMat, x, 0.36, z);
				}
			}
			// Rounded tabletop
			rbox(group, topMat, w, 0.046, d, 0.016, 0, 0.735, 0);
			// Drawer unit & brass pull
			rbox(group, drawerMat, 0.39, 0.135, d - 0.09, 0.012, w / 2 - 0.24, 0.645, 0.005);
			rbox(group, metalMat(brass), 0.11, 0.014, 0.018, 0.006, w / 2 - 0.24, 0.645, d / 2 - 0.032, false);
			// Desk mat
			rbox(group, matPad, 0.62, 0.006, 0.31, 0.003, -0.14, 0.761, 0.04, false);
			// Minimalist monitor + aluminum stand
			rbox(group, aluMat, 0.14, 0.012, 0.12, 0.004, -0.14, 0.764, -0.15, false);
			rbox(group, aluMat, 0.032, 0.15, 0.018, 0.005, -0.14, 0.835, -0.175);
			rbox(group, matte(charcoal, 0.45), 0.48, 0.285, 0.022, 0.008, -0.14, 0.96, -0.165);
			box(group, 0xe6efe9, 0.455, 0.258, 0.005, -0.14, 0.962, -0.152, false);
			mesh(group, new THREE.PlaneGeometry(0.45, 0.254), screenMat, -0.14, 0.962, -0.149, false);
			// Keyboard & mouse
			rbox(group, matte(linen, 0.7), 0.26, 0.012, 0.095, 0.004, -0.17, 0.769, 0.035, false);
			rbox(group, matte(linen, 0.65), 0.052, 0.018, 0.085, 0.009, 0.04, 0.77, 0.045, false);
			// Books & ceramic mug
			rbox(group, matte(0x7e93a8, 0.85), 0.16, 0.026, 0.21, 0.004, 0.43, 0.771, -0.1, false);
			rbox(group, matte(0xd9c4a3, 0.85), 0.14, 0.022, 0.19, 0.004, 0.425, 0.795, -0.095, false);
			mesh(group, new THREE.CylinderGeometry(0.032, 0.028, 0.072, 14), ceramicMat(0xc46a4a), 0.26, 0.794, 0.08);
			break;
		}
		case "chair": {
			const seatMat = matte(0xc47b5a, 0.88);
			const frameMat = woodMat(oak, 0.62);
			taperedLegs(group, w, d, 0.43, walnut, 0.065, 0.019, 0.013);
			// Rounded seat cushion + wooden apron
			rbox(group, frameMat, w - 0.02, 0.035, d - 0.02, 0.012, 0, 0.435, 0);
			rbox(group, seatMat, w - 0.01, 0.062, d - 0.02, 0.028, 0, 0.475, 0);
			// Curved upright posts & sculpted backrest
			for (const x of [-w / 2 + 0.065, w / 2 - 0.065]) {
				mesh(group, new THREE.CylinderGeometry(0.017, 0.019, 0.41, 10), frameMat, x, 0.65, d / 2 - 0.05);
			}
			rbox(group, seatMat, w - 0.05, 0.23, 0.058, 0.025, 0, 0.74, d / 2 - 0.065);
			break;
		}
		case "sofa": {
			const bodyMat = matte(0x7c8e6e, 0.92); // Hearth-style calm sage green sofa
			const cushionMat = matte(0x889b79, 0.9);
			const pillowA = matte(0xdfba73, 0.9);
			const pillowB = matte(0xf0e7d6, 0.9);

			taperedLegs(group, w, d, 0.13, walnut, 0.08, 0.025, 0.016);
			// Sculpted rounded base & backrest
			rbox(group, bodyMat, w, 0.22, d - 0.04, 0.045, 0, 0.23, 0.01);
			rbox(group, bodyMat, w, 0.62, 0.16, 0.055, 0, 0.51, -d / 2 + 0.09);
			// Rounded armrests + 2 plush seat cushions + 2 angled back cushions + throw pillows
			const seatW = (w - 0.3) / 2;
			for (const dir of [-1, 1]) {
				rbox(group, bodyMat, 0.145, 0.42, d - 0.02, 0.055, dir * (w / 2 - 0.072), 0.39, 0);
				rbox(group, cushionMat, seatW - 0.012, 0.145, d - 0.19, 0.048, dir * (seatW / 2 + 0.006), 0.395, 0.075);
				const backCushion = rbox(group, cushionMat, seatW - 0.016, 0.32, 0.135, 0.05,
					dir * (seatW / 2 + 0.006), 0.59, -d / 2 + 0.21);
				backCushion.rotation.x = -0.14;
				const pillow = rbox(group, dir === 1 ? pillowA : pillowB, 0.25, 0.24, 0.09, 0.04,
					dir * (w / 2 - 0.29), 0.56, -d / 2 + 0.29);
				pillow.rotation.set(-0.2, dir * -0.25, dir * 0.18);
			}
			break;
		}
		case "cabinet": {
			const bodyMat = woodMat(oak, 0.62);
			const doorMat = woodMat(warmWood, 0.68);
			const handleMat = metalMat(brass);
			taperedLegs(group, w, d, 0.15, walnut, 0.07, 0.021, 0.014);
			// Main credenza body
			rbox(group, bodyMat, w, 0.56, d, 0.018, 0, 0.43, 0);
			// Two recessed doors with vertical architectural slats & brass pulls
			const doorW = (w - 0.08) / 2;
			for (const x of [-doorW / 2 - 0.01, doorW / 2 + 0.01]) {
				rbox(group, doorMat, doorW - 0.012, 0.49, 0.022, 0.008, x, 0.43, d / 2 - 0.006);
				rbox(group, handleMat, 0.018, 0.11, 0.022, 0.006, x > 0 ? x - doorW * 0.35 : x + doorW * 0.35, 0.45, d / 2 + 0.01, false);
			}
			// Tasteful top styling: ceramic vase + stacked books
			mesh(group, new THREE.CylinderGeometry(0.036, 0.054, 0.17, 16), ceramicMat(0xefe8db), -w * 0.28, 0.795, -0.02);
			mesh(group, new THREE.CylinderGeometry(0.022, 0.036, 0.04, 14), ceramicMat(0xefe8db), -w * 0.28, 0.895, -0.02);
			rbox(group, matte(0x8a9b7c, 0.85), 0.22, 0.026, 0.16, 0.004, w * 0.2, 0.723, 0.01, false);
			rbox(group, matte(0xc46a4a, 0.85), 0.18, 0.022, 0.14, 0.004, w * 0.19, 0.747, 0.01, false);
			break;
		}
		case "plant": {
			const potMat = matte(0xc46a4a, 0.82);
			const soilMat = matte(0x5b4639, 0.96);
			const stemMat = woodMat(0x6c5844, 0.85);
			const leafLight = matte(0x6e8c5b, 0.78);
			const leafDark = matte(0x4f6d47, 0.78);

			// Terracotta planter with rolled top lip
			mesh(group, new THREE.CylinderGeometry(0.175, 0.125, 0.25, 22), potMat, 0, 0.125, 0);
			mesh(group, new THREE.TorusGeometry(0.172, 0.018, 10, 24), potMat, 0, 0.245, 0).rotation.x = Math.PI / 2;
			mesh(group, new THREE.CylinderGeometry(0.155, 0.155, 0.014, 18), soilMat, 0, 0.24, 0, false);

			// Woody stems + layered sculptural foliage
			for (let i = 0; i < 11; i++) {
				const angle = i * 2.399;
				const tier = i % 4;
				const radius = 0.05 + (i % 3) * 0.042;
				const y = 0.34 + tier * 0.125;
				const stemH = y - 0.22;
				const stem = mesh(group, new THREE.CylinderGeometry(0.007, 0.01, stemH, 6), stemMat,
					Math.cos(angle) * radius * 0.55, 0.23 + stemH / 2, Math.sin(angle) * radius * 0.55, false);
				stem.rotation.set(Math.sin(angle) * 0.18, 0, -Math.cos(angle) * 0.18);

				const leaf = mesh(group, new THREE.SphereGeometry(1, 10, 8), i % 2 ? leafLight : leafDark,
					Math.cos(angle) * radius * 1.15, y, Math.sin(angle) * radius * 1.15);
				leaf.scale.set(0.095, 0.165, 0.032);
				leaf.rotation.set(0.32 * Math.sin(angle), -angle, 0.62 * Math.cos(angle));
			}
			break;
		}
		case "lamp": {
			const baseMat = ceramicMat(0xe5ddd0);
			const brassMat = metalMat(brass, 0.28, 0.8);
			const shadeMat = new THREE.MeshStandardMaterial({
				color: 0xf8ebd1,
				emissive: 0xffd996,
				emissiveIntensity: 0.45,
				roughness: 0.78,
				side: THREE.DoubleSide,
			});

			mesh(group, new THREE.CylinderGeometry(0.145, 0.155, 0.038, 24), baseMat, 0, 0.019, 0);
			mesh(group, new THREE.CylinderGeometry(0.032, 0.038, 0.025, 16), brassMat, 0, 0.048, 0);
			mesh(group, new THREE.CylinderGeometry(0.013, 0.015, 1.42, 12), brassMat, 0, 0.75, 0);
			mesh(group, new THREE.CylinderGeometry(0.115, 0.17, 0.26, 24, 1, false), shadeMat, 0, 1.48, 0);
			// Warm golden pool of light like Hearth Studio
			const glow = new THREE.PointLight(0xffdaa0, 0.95, 3.3, 1.9);
			glow.position.set(0, 1.38, 0);
			group.add(glow);
			break;
		}
		case "rug": {
			const mat = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.96, metalness: 0 });
			rbox(group, mat, w, 0.014, d, 0.005, 0, 0.008, 0, false);
			// Subtle woven cream fringes along short sides
			const fringeMat = matte(0xeadfce, 0.95);
			for (const z of [-d / 2 - 0.018, d / 2 + 0.018]) {
				mesh(group, new THREE.BoxGeometry(w - 0.06, 0.005, 0.032), fringeMat, 0, 0.004, z, false);
			}
			break;
		}
	}
	return group;
}

function floorTexture(): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 1024;
	canvas.height = 832;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		// Bright pale Scandinavian oak planks
		const tones = ["#e4d2b8", "#dec9ac", "#e8d8c1", "#d9c3a5", "#e2cfb4", "#e6d5bc"];
		for (let row = 0; row < 22; row++) {
			for (let col = -1; col < 5; col++) {
				const x = col * 275 + (row * 103) % 275;
				const y = row * 38;
				ctx.fillStyle = tones[((row * 11 + col * 7) % tones.length + tones.length) % tones.length];
				ctx.fillRect(x, y, 274, 37);
				// Delicate plank seam
				ctx.strokeStyle = "rgba(126, 97, 68, 0.14)";
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(x, y + 37.5);
				ctx.lineTo(x + 275, y + 37.5);
				ctx.moveTo(x + 274.5, y);
				ctx.lineTo(x + 274.5, y + 38);
				ctx.stroke();
				// Subtle organic grain streaks
				for (let i = 0; i < 6; i++) {
					const step = (row * 83 + col * 41 + i * 97) % 200;
					ctx.fillStyle = i % 2 ? "rgba(138, 102, 68, 0.055)" : "rgba(255, 250, 240, 0.13)";
					ctx.fillRect(x + Math.abs(step), y + 5 + i * 5, 38 + i * 7, 1.2);
				}
			}
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	return texture;
}

function dropShadowTexture(): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 512;
	canvas.height = 512;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		const grad = ctx.createRadialGradient(256, 256, 60, 256, 256, 245);
		grad.addColorStop(0, "rgba(16, 26, 42, 0.16)");
		grad.addColorStop(0.58, "rgba(16, 26, 42, 0.08)");
		grad.addColorStop(1, "rgba(16, 26, 42, 0)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 512, 512);
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

export type RoomShell = {
	group: THREE.Group;
	walls: Record<WallSide, THREE.Group>;
	bathroomWalls: THREE.Group;
	planLabels: THREE.Group;
};

function drawDoorSwing(parent: THREE.Group, x: number, z: number, width: number, from: number, to: number): void {
	const leaf = box(parent, warmWood, width, 0.018, 0.022,
		x + width * Math.cos(to) / 2, 0.026, z + width * Math.sin(to) / 2, false, 0.65);
	leaf.rotation.y = -to;
	const points = Array.from({ length: 28 }, (_, step) => {
		const angle = from + (to - from) * step / 27;
		return new THREE.Vector3(x + width * Math.cos(angle), 0.024, z + width * Math.sin(angle));
	});
	const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
		new THREE.LineDashedMaterial({ color: 0x9c8266, dashSize: 0.048, gapSize: 0.032 }));
	arc.computeLineDistances();
	parent.add(arc);
}

function addBathroom(room: RoomSpec, group: THREE.Group, plan: THREE.Group, walls: THREE.Group, labels: THREE.Group): void {
	const bathroom = room.bathroom;
	if (!bathroom) return;
	const west = roomX(bathroom.x, room);
	const east = roomX(bathroom.x + bathroom.width, room);
	const north = roomZ(bathroom.z, room);
	const south = roomZ(bathroom.z + bathroom.depth, room);
	const centerX = (west + east) / 2;
	const centerZ = (north + south) / 2;
	const doorStart = roomX(bathroom.x + bathroom.door.offset, room);
	const doorWidth = meters(bathroom.door.width);
	const thick = meters(bathroom.wallThickness);
	const isSouth = bathroom.corner.startsWith("south");
	const isEast = bathroom.corner.endsWith("east");
	const horizWallZ = isSouth ? north : south;
	const vertWallX = isEast ? west : east;

	// Clean pale limestone-grey bathroom floor
	box(group, 0xedf0f5, east - west, 0.009, south - north, centerX, 0.003, centerZ, false, 0.78);
	const tileLines: THREE.Vector3[] = [];
	for (let x = west + 0.375; x < east - 0.03; x += 0.375) {
		tileLines.push(new THREE.Vector3(x, 0.011, north), new THREE.Vector3(x, 0.011, south));
	}
	for (let z = north + 0.375; z < south - 0.03; z += 0.375) {
		tileLines.push(new THREE.Vector3(west, 0.011, z), new THREE.Vector3(east, 0.011, z));
	}
	group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tileLines),
		new THREE.LineBasicMaterial({ color: 0xd3dbe6 })));

	// Partition walls (plan outline + 3D architectural low cutaway walls with crisp cap)
	for (const [target, height] of [[plan, 0.048], [walls, 1.05]] as const) {
		const color = target === plan ? 0x6c7c92 : plaster;
		box(target, color, thick, height, south - north + thick / 2, vertWallX, height / 2, centerZ + (isSouth ? -thick / 4 : thick / 4), target === walls, 0.88);
		for (const [start, end] of [[west, doorStart], [doorStart + doorWidth, east]]) {
			if (end - start <= 0.02) continue;
			box(target, color, end - start, height, thick, (end + start) / 2, height / 2, horizWallZ, target === walls, 0.88);
		}
		if (target === walls) {
			box(target, plasterCap, thick + 0.004, 0.012, south - north + thick / 2, vertWallX, height + 0.006, centerZ + (isSouth ? -thick / 4 : thick / 4), false, 0.9);
			for (const [start, end] of [[west, doorStart], [doorStart + doorWidth, east]]) {
				if (end - start <= 0.02) continue;
				box(target, plasterCap, end - start, 0.012, thick + 0.004, (end + start) / 2, height + 0.006, horizWallZ, false, 0.9);
			}
		}
	}

	// Minimalist 3D bathroom fixtures (only visible in 3D cutaway mode)
	const porcelain = ceramicMat();
	const chrome = metalMat(0xd6d2c9, 0.25, 0.82);
	const vanityX = isEast ? east - 0.26 : west + 0.26;
	const vanityZ = centerZ - 0.25;
	rbox(walls, woodMat(oak, 0.62), 0.44, 0.48, 0.82, 0.018, vanityX, 0.56, vanityZ);
	rbox(walls, porcelain, 0.46, 0.05, 0.84, 0.014, vanityX, 0.82, vanityZ);
	rbox(walls, matte(0xdcd7cd, 0.5), 0.3, 0.02, 0.48, 0.01, vanityX, 0.846, vanityZ, false);
	mesh(walls, new THREE.CylinderGeometry(0.012, 0.014, 0.11, 10), chrome, vanityX + (isEast ? 0.14 : -0.14), 0.89, vanityZ, false);

	const toiletX = isEast ? west + 0.34 : east - 0.34;
	const toiletZ = isSouth ? south - 0.72 : north + 0.72;
	rbox(walls, porcelain, 0.18, 0.68, 0.38, 0.025, toiletX + (isEast ? -0.17 : 0.17), 0.39, toiletZ);
	mesh(walls, new THREE.CylinderGeometry(0.18, 0.13, 0.38, 18), porcelain, toiletX + (isEast ? 0.06 : -0.06), 0.19, toiletZ);
	mesh(walls, new THREE.CylinderGeometry(0.185, 0.185, 0.035, 18), porcelain, toiletX + (isEast ? 0.06 : -0.06), 0.39, toiletZ);

	const showerW = Math.min(0.95, (east - west) * 0.45);
	const showerD = Math.min(0.95, (south - north) * 0.42);
	const showerX = isEast ? east - showerW / 2 - 0.03 : west + showerW / 2 + 0.03;
	const showerZ = isSouth ? south - showerD / 2 - 0.03 : north + showerD / 2 + 0.03;
	rbox(walls, porcelain, showerW, 0.036, showerD, 0.01, showerX, 0.02, showerZ, false);
	const glassPanel = new THREE.MeshStandardMaterial({
		color: 0xdce6e4, transparent: true, opacity: 0.34, roughness: 0.12, metalness: 0.08,
	});
	mesh(walls, new THREE.BoxGeometry(showerW * 0.72, 1.02, 0.016), glassPanel,
		showerX, 0.53, isSouth ? south - showerD - 0.03 : north + showerD + 0.03, false);

	drawDoorSwing(plan, doorStart, horizWallZ, doorWidth, 0, isSouth ? Math.PI / 2 : -Math.PI / 2);
	addPlanLabel(labels, centerX, centerZ + 0.12, Math.min(1.48, east - west - 0.2), "卫生间",
		`${meters(bathroom.width).toFixed(2)} × ${meters(bathroom.depth).toFixed(2)} m`);
}

function addPassage(room: RoomSpec, planLabels: THREE.Group): void {
	const passage = room.passage;
	if (!passage) return;
	const x = roomX(passage.x + passage.width / 2, room);
	const z = roomZ(passage.z + passage.depth / 2, room);
	const w = meters(passage.width);
	const d = meters(passage.depth);
	const tint = mesh(planLabels, new THREE.PlaneGeometry(w, d),
		new THREE.MeshBasicMaterial({ color: 0xe6eef9, transparent: true, opacity: 0.45, depthWrite: false }), x, 0.008, z, false);
	tint.rotation.x = -Math.PI / 2;
	const openEdgeX = passage.x > 0 ? x - w / 2 : x + w / 2;
	const openEdge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(openEdgeX, 0.019, z - d / 2),
		new THREE.Vector3(openEdgeX, 0.019, z + d / 2),
	]), new THREE.LineDashedMaterial({ color: 0x6b7f9a, dashSize: 0.055, gapSize: 0.048 }));
	openEdge.computeLineDistances();
	planLabels.add(openEdge);
	addPlanLabel(planLabels, roomX(passage.x + passage.width * 0.34, room), z, Math.min(0.66, w * 0.5), "过道");
}

function addPlanLabel(parent: THREE.Group, x: number, z: number, width: number, title: string, detail?: string): void {
	const canvas = document.createElement("canvas");
	canvas.width = 480;
	canvas.height = 200;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
	ctx.strokeStyle = "rgba(16, 26, 42, 0.14)";
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.roundRect(10, 12, 460, 176, 26);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = "#101a2a";
	ctx.textAlign = "center";
	ctx.font = `${detail ? "600 60px" : "600 84px"} "PingFang SC", "Microsoft YaHei", sans-serif`;
	ctx.fillText(title, 240, detail ? 88 : 128);
	if (detail) {
		ctx.fillStyle = "#495c76";
		ctx.font = '500 34px "Cascadia Mono", Consolas, monospace';
		ctx.fillText(detail, 240, 146);
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	const label = mesh(parent, new THREE.PlaneGeometry(width, width * canvas.height / canvas.width),
		new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }), x, 0.024, z, false);
	label.rotation.x = -Math.PI / 2;
}

export function createRoomShell(room: RoomSpec = ROOM): RoomShell {
	const group = new THREE.Group();
	const plan = new THREE.Group();
	const bathroomWalls = new THREE.Group();
	const planLabels = new THREE.Group();
	group.add(plan, bathroomWalls, planLabels);
	const w = meters(room.width);
	const d = meters(room.depth);
	const h = meters(room.height);
	const trim = 0x9fb0c7;
	const frame = 0xd6dce6;

	// Soft ambient ground shadow plane underneath the architectural maquette
	const shadowPlane = mesh(group, new THREE.PlaneGeometry(w + 2.6, d + 2.6),
		new THREE.MeshBasicMaterial({ map: dropShadowTexture(), transparent: true, depthWrite: false }),
		0, -0.22, 0, false);
	shadowPlane.rotation.x = -Math.PI / 2;

	// Architectural plinth slab (crisp cool-white gallery base)
	box(group, 0xe4e9f2, w + 0.22, 0.16, d + 0.22, 0, -0.095, 0, false, 0.86);
	box(group, 0xd0d9e6, w + 0.24, 0.035, d + 0.24, 0, -0.185, 0, false, 0.88);

	// Pale Scandinavian oak floor
	const floor = mesh(group, new THREE.PlaneGeometry(w + 0.02, d + 0.02),
		new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.78, metalness: 0.02 }), 0, -0.002, 0, false);
	floor.rotation.x = -Math.PI / 2;

	const walls: Record<WallSide, THREE.Group> = {
		north: new THREE.Group(), east: new THREE.Group(), south: new THREE.Group(), west: new THREE.Group(),
	};
	group.add(...Object.values(walls));

	const windowGlowMat = new THREE.MeshStandardMaterial({
		color: 0xffffff, emissive: 0xeef5ff, emissiveIntensity: 0.52, roughness: 0.2,
	});

	for (const side of ["north", "east", "south", "west"] as const) {
		const wall = walls[side];
		const horizontal = isHorizontalWall(side);
		const sign = isMinWall(side) ? -1 : 1;
		const limit = (horizontal ? w : d) / 2;
		const edge = (horizontal ? d : w) / 2 * sign;
		const wallBox = (target: THREE.Group, color: number, length: number, height: number, thick: number,
			along: number, y: number, inset = 0, shadow = true, roughness = 0.88): void => {
			const normal = edge + sign * (0.049 - inset);
			if (horizontal) box(target, color, length, height, thick, along, y, normal, shadow, roughness);
			else box(target, color, thick, height, length, normal, y, along, shadow, roughness);
		};
		const span = (left: number, right: number, y: number, height: number, addBaseboard = false): void => {
			const len = right - left;
			if (len <= 0.001) return;
			const center = (right + left) / 2;
			wallBox(wall, plaster, len, height, 0.1, center, y);
			// Crisp cutaway cap on top of full-height walls
			if (y + height / 2 >= h - 0.02) {
				wallBox(wall, plasterCap, len, 0.014, 0.104, center, h + 0.007, 0, false, 0.92);
			}
			// Interior baseboard molding
			if (addBaseboard) {
				wallBox(wall, baseboard, len, 0.085, 0.014, center, 0.042, 0.056, false, 0.72);
			}
		};
		const window = side === room.window.side ? room.window : undefined;
		const door = side === room.door.side ? room.door : undefined;
		const opening = window ?? door;
		const start = horizontal ? -limit : -limit - 0.1;
		const end = -start;
		if (!opening) {
			span(start, end, h / 2, h, true);
			wallBox(plan, trim, end - start, 0.052, 0.1, 0, 0.022, 0, false);
			continue;
		}
		const a = meters(opening.offset) - limit;
		const b = a + meters(opening.width);
		for (const [left, right] of [[start, a], [b, end]]) {
			span(left, right, h / 2, h, true);
			wallBox(plan, trim, right - left, 0.052, 0.1, (right + left) / 2, 0.022, 0, false);
		}
		if (window) {
			const sill = meters(window.sill);
			const top = sill + meters(window.height);
			const center = (a + b) / 2;
			span(a, b, sill / 2, sill, true);
			span(a, b, (top + h) / 2, h - top, false);
			// Sunlit glowing window glass
			const normal = edge + sign * 0.049;
			if (horizontal) mesh(wall, new THREE.BoxGeometry(b - a, top - sill, 0.02), windowGlowMat, center, (sill + top) / 2, normal, false);
			else mesh(wall, new THREE.BoxGeometry(0.02, top - sill, b - a), windowGlowMat, normal, (sill + top) / 2, center, false);

			for (const along of [a + 0.022, center, b - 0.022]) {
				wallBox(wall, frame, 0.04, top - sill, 0.08, along, (top + sill) / 2, 0.012, true, 0.65);
			}
			wallBox(wall, frame, b - a, 0.044, 0.075, center, top - 0.022, 0, true, 0.65);
			wallBox(wall, baseboard, b - a + 0.12, 0.05, 0.18, center, sill, 0.045, true, 0.65);
			wallBox(plan, 0x9fb6b2, b - a, 0.038, 0.09, center, 0.017, 0, false);
		} else if (door) {
			const top = meters(door.height);
			span(a, b, (top + h) / 2, h - top, false);
			wallBox(wall, frame, 0.046, top, 0.15, a + 0.02, top / 2, 0, true, 0.65);
			wallBox(wall, frame, 0.046, top, 0.15, b - 0.02, top / 2, 0, true, 0.65);
			wallBox(wall, frame, b - a, 0.055, 0.15, (a + b) / 2, top, 0, true, 0.65);
			const openAngle = horizontal ? -sign * Math.PI / 2 : sign > 0 ? Math.PI : 0;
			drawDoorSwing(plan, horizontal ? a : edge, horizontal ? edge : a, b - a, horizontal ? 0 : Math.PI / 2, openAngle);
		}
	}

	// Framed minimalist gallery art prints on north wall (when north wall has no door/window)
	if (room.window.side !== "north" && room.door.side !== "north" && w >= 4.2) {
		const art = walls.north;
		for (const [i, x] of [-w * 0.34, -w * 0.24].entries()) {
			const fh = 0.56 - i * 0.06;
			rbox(art, woodMat(oak, 0.6), 0.44, fh, 0.03, 0.006, x, 1.54, -d / 2 + 0.018);
			box(art, 0xf7f3ea, 0.38, fh - 0.06, 0.012, x, 1.54, -d / 2 + 0.034, false, 0.92);
			box(art, i ? 0x8a9b7c : 0xc46a4a, 0.21, 0.24, 0.008, x, 1.56, -d / 2 + 0.042, false, 0.88);
			box(art, i ? 0xd9c4a3 : 0x3e3a36, 0.12, 0.06, 0.008, x + (i ? -0.04 : 0.04), 1.44, -d / 2 + 0.043, false, 0.88);
		}
	}

	addBathroom(room, group, plan, bathroomWalls, planLabels);
	addPassage(room, planLabels);
	return { group, walls, bathroomWalls, planLabels };
}

export function createDraftPreview(spec: RoomSpec): THREE.Group {
	const group = new THREE.Group();
	const w = meters(spec.width);
	const d = meters(spec.depth);
	const h = meters(spec.height);

	const ghostBox = new THREE.LineSegments(
		new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
		new THREE.LineDashedMaterial({ color: 0x2853a1, dashSize: 0.14, gapSize: 0.08 }),
	);
	ghostBox.position.set(0, h / 2, 0);
	ghostBox.computeLineDistances();
	group.add(ghostBox);

	const pad = new THREE.Mesh(
		new THREE.PlaneGeometry(w, d),
		new THREE.MeshBasicMaterial({ color: 0x2853a1, transparent: true, opacity: 0.06, depthWrite: false }),
	);
	pad.rotation.x = -Math.PI / 2;
	pad.position.y = 0.03;
	group.add(pad);

	if (spec.bathroom) {
		const bw = meters(spec.bathroom.width);
		const bd = meters(spec.bathroom.depth);
		const bx = roomX(spec.bathroom.x + spec.bathroom.width / 2, spec);
		const bz = roomZ(spec.bathroom.z + spec.bathroom.depth / 2, spec);
		const bathEdges = new THREE.LineSegments(
			new THREE.EdgesGeometry(new THREE.BoxGeometry(bw, 1.05, bd)),
			new THREE.LineDashedMaterial({ color: 0x4f6f52, dashSize: 0.1, gapSize: 0.07 }),
		);
		bathEdges.position.set(bx, 0.525, bz);
		bathEdges.computeLineDistances();
		group.add(bathEdges);
	}

	return group;
}

export function disposeScene(object: THREE.Object3D): void {
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	const textures = new Set<THREE.Texture>();
	object.traverse((child) => {
		if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
		geometries.add(child.geometry);
		for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
			materials.add(material);
			if ((material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) && material.map) {
				textures.add(material.map);
			}
		}
	});
	for (const texture of textures) texture.dispose();
	for (const material of materials) material.dispose();
	for (const geometry of geometries) geometry.dispose();
}
