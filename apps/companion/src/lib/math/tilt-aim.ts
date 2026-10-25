import { clamp } from "./motion";

const deadzoneDegrees = 1.2;
const fullTiltDegrees = 22;
const maximumAimRate = 130;

/** Converts calibrated phone tilt to a continuous camera rate in degrees/second. */
export function aimFromTilt(horizontalDegrees: number, verticalDegrees: number): { x: number; y: number } {
	const amount = Math.hypot(horizontalDegrees, verticalDegrees);
	if (!Number.isFinite(amount) || amount <= deadzoneDegrees) return { x: 0, y: 0 };
	const response = Math.pow(clamp((amount - deadzoneDegrees) / (fullTiltDegrees - deadzoneDegrees), 0, 1), 0.85);
	const rate = response * maximumAimRate;
	return { x: horizontalDegrees / amount * rate, y: verticalDegrees / amount * rate };
}
