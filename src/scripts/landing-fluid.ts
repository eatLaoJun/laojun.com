import { createWebGLFluid } from "./vendor/webgl-fluid.js";

export function createLandingFluid(canvas: HTMLCanvasElement, surface: HTMLElement) {
	let simulation: ReturnType<typeof createWebGLFluid>;
	try {
		simulation = createWebGLFluid(canvas);
	} catch {
		return;
	}

	function coordinates(event: PointerEvent) {
		const bounds = canvas.getBoundingClientRect();
		return [event.clientX - bounds.left, event.clientY - bounds.top] as const;
	}

	surface.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		surface.setPointerCapture(event.pointerId);
		simulation.start(event.pointerId, ...coordinates(event));
	});
	surface.addEventListener("pointermove", (event) => {
		simulation.move(event.pointerId, ...coordinates(event));
	});
	for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
		surface.addEventListener(type, (event) => simulation.end(event.pointerId));
	}
	return simulation;
}
