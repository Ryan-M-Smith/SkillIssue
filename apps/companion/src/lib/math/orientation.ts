import type { MotionVector } from "@/types/motion";
import { clamp, cross, dot, normalize } from "@/lib/math/motion";

/** A 3x3 matrix as rows. */
export type Mat3 = [MotionVector, MotionVector, MotionVector];

/** The parts of the motion model's calibrated frame a view needs. */
export type PlayerFrame = {
	down: MotionVector; // gravity at neutral, phone frame
	up: MotionVector; // screen's up direction
	right: MotionVector; // player's left-right axis
	away: MotionVector; // level, pointing away from the player
};

function mulMat(a: Mat3, b: Mat3): Mat3 {
	const col = (j: 0 | 1 | 2): MotionVector => ({
		x: j === 0 ? b[0].x : j === 1 ? b[0].y : b[0].z,
		y: j === 0 ? b[1].x : j === 1 ? b[1].y : b[1].z,
		z: j === 0 ? b[2].x : j === 1 ? b[2].y : b[2].z,
	});
	const c0 = col(0), c1 = col(1), c2 = col(2);
	const row = (r: MotionVector): MotionVector => ({ x: dot(r, c0), y: dot(r, c1), z: dot(r, c2) });
	return [row(a[0]), row(a[1]), row(a[2])];
}

// Rotation matrix about a unit axis (Rodrigues).
function axisAngle(axis: MotionVector, angle: number): Mat3 {
	const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
	const { x, y, z } = axis;
	return [
		{ x: t * x * x + c, y: t * x * y - s * z, z: t * x * z + s * y },
		{ x: t * x * y + s * z, y: t * y * y + c, z: t * y * z - s * x },
		{ x: t * x * z - s * y, y: t * y * z + s * x, z: t * z * z + c },
	];
}

/**
 * The phone's orientation in the player's world (x = player's right,
 * y = away from the player, z = up), as a phone-frame -> world rotation.
 *
 * At calibration the phone sits exactly in the model's frame. Since then,
 * gravity in the phone frame has moved from `frame.down` to `gravity`; the
 * smallest rotation that explains that is applied, plus `yawDeg` about the
 * vertical (which gravity alone can't show).
 */
export function displayRotation(
	frame: PlayerFrame,
	gravity: MotionVector,
	yawDeg = 0
): Mat3 {
	const upWorld: MotionVector = { x: -frame.down.x, y: -frame.down.y, z: -frame.down.z };
	const atCalibration: Mat3 = [frame.right, frame.away, upWorld];

	// Smallest rotation (phone frame) taking current gravity to neutral gravity.
	const g = normalize(gravity);
	const axis = cross(g, frame.down);
	const sin = Math.hypot(axis.x, axis.y, axis.z);
	const cos = clamp(dot(g, frame.down));
	const tilt: Mat3 = sin < 1e-6
		? [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
		: axisAngle(normalize(axis), Math.atan2(sin, cos));

	const yaw = (yawDeg * Math.PI) / 180;
	const turn: Mat3 = [
		{ x: Math.cos(yaw), y: -Math.sin(yaw), z: 0 },
		{ x: Math.sin(yaw), y: Math.cos(yaw), z: 0 },
		{ x: 0, y: 0, z: 1 },
	];

	return mulMat(turn, mulMat(atCalibration, tilt));
}
