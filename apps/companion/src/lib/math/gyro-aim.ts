import { clamp } from "./motion";

/** Mouse-style relative aiming, in camera degrees/second. No held-tilt steering. */
export function gyroAim(yaw: number, pitch: number): { x: number; y: number } {
	const speed = Math.hypot(yaw, pitch);
	if (!Number.isFinite(speed) || speed <= 1.2) return { x: 0, y: 0 };
	// One radial curve preserves diagonal direction. Tiny wrist corrections stay
	// precise; fast turns get only modest extra gain to allow a full camera sweep without overshoot.
	const precision = clamp((speed - 1.2) / 3.3, 0, 1);
	const acceleration = clamp((speed - 50) / 180, 0, 1);
	const smooth = (x: number) => x * x * (3 - 2 * x);
	const gain = 0.75 + 0.55 * smooth(acceleration) * smooth(precision);
	return { x: yaw * gain, y: pitch * gain };
}
