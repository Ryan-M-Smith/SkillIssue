import { clamp } from "./motion";

const noiseFloor = 0.2; // deg/s: a phone at rest reads about this much
const exactFrom = 1; // deg/s: from here up the camera turns exactly as far as the phone

/**
 * 1:1 motion aim, in camera degrees/second: the view turns by exactly what the phone turned,
 * so pointing the phone back where it was puts the view back where it was. Only resting noise
 * is removed, with a short ramp so slow corrections don't jump in.
 */
export function gyroAim(yaw: number, pitch: number): { x: number; y: number } {
	const speed = Math.hypot(yaw, pitch);
	if (!Number.isFinite(speed) || speed <= noiseFloor) return { x: 0, y: 0 };
	const gain = clamp((speed - noiseFloor) / (exactFrom - noiseFloor), 0, 1);
	return { x: yaw * gain, y: pitch * gain };
}
