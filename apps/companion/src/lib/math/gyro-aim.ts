import { clamp } from "./motion";

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Mouse-style relative aiming, in camera degrees/second. No held-tilt steering.
 * Slow corrections turn the view a little more than the phone (precise, still easy to
 * follow); quick wrist snaps turn it up to 3×, so a 180° turn is a ~60° flick, not a spin.
 */
export function gyroAim(yaw: number, pitch: number): { x: number; y: number } {
	const speed = Math.hypot(yaw, pitch);
	if (!Number.isFinite(speed) || speed <= 1.2) return { x: 0, y: 0 };
	// One radial curve preserves diagonal direction; the noise threshold fades in smoothly.
	const precision = clamp((speed - 1.2) / 3.3, 0, 1);
	const acceleration = clamp((speed - 40) / 180, 0, 1);
	const gain = 1.25 + 1.75 * smooth(acceleration);
	return { x: yaw * gain * smooth(precision), y: pitch * gain * smooth(precision) };
}

const edgeStartDeg = 15;
const edgeFullDeg = 40;
const edgeMaxRate = 160;

/**
 * Steering-wheel turning, degrees/second: hold one end of the phone dipped past 15° and
 * the view keeps turning that way (full speed at 40°). Level it and the turn stops.
 * Lets the gunner turn around without physically spinning.
 */
export function edgeTurn(rollDeg: number): number {
	const past = (Math.abs(rollDeg) - edgeStartDeg) / (edgeFullDeg - edgeStartDeg);
	if (!Number.isFinite(past) || past <= 0) return 0;
	return Math.sign(rollDeg) * edgeMaxRate * smooth(clamp(past, 0, 1));
}
