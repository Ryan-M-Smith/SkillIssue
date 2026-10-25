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

/** Sensor timestamp in seconds, as expo-sensors reports it (monotonic). */
type Stamped = { timestamp?: number };

export type MotionReading = {
	rotation: MotionAngles & Stamped;
	rotationRate: (MotionAngles & Stamped) | null;
	acceleration: (MotionVector & Stamped) | null;
	accelerationIncludingGravity: MotionVector & Stamped;
};

/**
 * One-shot gesture recognised this sample.
 * - jump:   quick flick back (top of the phone toward you)
 * - crouch: quick flick forward; toggles crouch on/off
 * - stand:  jump flick while crouched; stands up instead of jumping
 * - sprint: quick twist about the screen axis (Z); toggles sprint on/off
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
	/** Held tilt from neutral, degrees. + = top away (forward). */
	pitchDeg: number;
	/** Held tilt from neutral, degrees. + = right side down. */
	sidePressDeg: number;
	/** Gyroscope about the phone's X axis (pitch), deg/s. */
	pitchRate: number;
	/** Gyroscope about the phone's Y axis (left/right), deg/s. */
	sidePressRate: number;
	/** Gyroscope about the phone's Z axis (twist), deg/s. */
	twistRate: number;
	/** Axis of the fast motion in progress, if any. */
	burst: "none" | "pitch" | "side" | "twist";
	sprintPhase: "off" | "on";
	gesture: "armed" | "locked";
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