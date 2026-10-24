import type { MotionAngles, MotionVector } from "@/types/motion";

export function clamp(n: number, min = -1, max = 1) {
	return Math.max(min, Math.min(max, n));
}

export function magnitude(v: MotionVector) {
	return Math.hypot(v.x, v.y, v.z);
}

export function angularMagnitude(v: MotionAngles | null) {
	return v? Math.hypot(v.alpha, v.beta, v.gamma) : 0;
}

export function radToDeg(rad: number) {
	return (rad * 180) / Math.PI;
}

export function angleDiff(current: number, initial: number) {
	return Math.atan2(
		Math.sin(current - initial),
		Math.cos(current - initial)
	);
}