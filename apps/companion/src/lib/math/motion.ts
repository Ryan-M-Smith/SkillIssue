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

/**
 * The gyroscope rate about the phone's own axes, in deg/s.
 * x runs across the screen (pitch), y runs along it (left/right tilt),
 * z points out of the screen (twist).
 *
 * expo-sensors fills DeviceMotion.rotationRate differently per platform
 * (see DeviceMotionModule.swift / .kt in expo-sensors 58):
 *   iOS      alpha = z, beta = y, gamma = x
 *   Android  alpha = x, beta = y, gamma = z
 *   web      alpha = z, beta = x, gamma = y (W3C DeviceMotionEvent)
 */
export function deviceRotationRate(
	rate: MotionAngles,
	platform: string
): MotionVector {
	switch (platform) {
		case "android":
			return { x: rate.alpha, y: rate.beta, z: rate.gamma };
		case "web":
			return { x: rate.beta, y: rate.gamma, z: rate.alpha };
		default:
			return { x: rate.gamma, y: rate.beta, z: rate.alpha };
	}
}


export function dot(a: MotionVector, b: MotionVector) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: MotionVector, b: MotionVector): MotionVector {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

export function scale(v: MotionVector, k: number): MotionVector {
	return { x: v.x * k, y: v.y * k, z: v.z * k };
}

export function normalize(v: MotionVector): MotionVector {
	const length = magnitude(v);
	return length > 1e-9 ? scale(v, 1 / length) : { x: 0, y: 0, z: 0 };
}
