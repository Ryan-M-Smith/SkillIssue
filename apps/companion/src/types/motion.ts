import type { Vector3 } from "@/lib/math/vector3";

export type Role = "movement" | "gunner";

export type MotionAngles = {
	alpha: number;
	beta: number;
	gamma: number;
};

export type MotionVector = {
	x: number;
	y: number;
	z: number;
};

export type MotionReading = {
	rotation: MotionAngles;
	rotationRate: MotionAngles | null;
	acceleration: MotionVector | null;
	accelerationIncludingGravity: MotionVector;
};

/**
 * One-shot gesture recognised this sample.
 * - jump:   quick flick back (top of the phone toward you)
 * - crouch: quick flick forward; toggles crouch on/off
 * - stand:  jump flick while crouched; stands up instead of jumping
 * - sprint: quick side-to-side shake; toggles sprint on/off
 * - shoot:  gunner forward jab
 */
export type Action = "jump" | "crouch" | "stand" | "sprint" | "shoot" | null;

export type GameControls = {
	ready: boolean;
	moveX: number;
	moveY: number;
	sprint: boolean;
	crouch: boolean;
	lookX: number;
	lookY: number;
	action: Action;
};

export type MotionDebug = {
	calibration: "calibrating" | "ready";
	pitchDeg: number;
	sidePressDeg: number;
	pitchRate: number;
	sidePressRate: number;
	sprintPhase: "off" | "shaking" | "on";
	gesture: "armed" | "locked";
	strafeMeters: number;
	positionTracking: "missing" | "tracking";
};

export type Counts = Record<Exclude<Action, null>, number>;

export type RawMotion = {
	alpha: number;
	beta: number;
	gamma: number;
	yawRate: number;
	pitchRate: number;
	accX: number;
	accY: number;
	accZ: number;
};

export type AveragedMotion = {
	gyro: Vector3;
	accel: Vector3;
};