import { clamp } from "./motion";

/** Mouse-style relative aiming, in camera degrees/second. No held-tilt steering. */
export function gyroAim(yaw: number, pitch: number): { x: number; y: number } {
	const speed = Math.hypot(yaw, pitch);
	if (!Number.isFinite(speed) || speed <= 1) return { x: 0, y: 0 };
	// One radial curve preserves diagonal direction. Tiny wrist corrections stay
	// precise; a brisk 30-degree sweep can turn the view by up to 90 degrees.
	const precision = clamp((speed - 1) / 2.5, 0, 1);
	const acceleration = clamp((speed - 20) / 70, 0, 1);
	const smooth = (x: number) => x * x * (3 - 2 * x);
	const gain = smooth(precision) * (1.5 + 1.5 * smooth(acceleration));
	return { x: yaw * gain, y: pitch * gain };
}
