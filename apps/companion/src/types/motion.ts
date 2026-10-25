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
 * - sprint: comfortable wheel twist, then return to neutral to re-arm
 * - shoot:  gunner forward jab
 * - reload: gunner upward lift
 * - weapon_next: gunner wheel twist
 * - scope: gunner pull back
 */
export type Action = "jump" | "crouch" | "stand" | "sprint" | "shoot" | "reload" | "weapon_next" | "scope" | null;

export type GameControls = {
	ready: boolean;
	moveX: number;
	moveY: number;
	sprint: boolean;
	crouch: boolean;
	lookX: number;
	lookY: number;
	/** Gunner: degrees the phone turned this sample (+ = right / up), for 1:1 aiming. */
	lookDX?: number;
	lookDY?: number;
	action: Action;
};

/** How the phone was held at calibration, worked out from gravity. */
export type Grip = "portrait" | "landscape" | "upside down" | "flat";

export type MotionDebug = {
	calibration: "calibrating" | "ready";
	grip: Grip;
	/** Held tilt from neutral, degrees. + = top away (forward). */
	pitchDeg: number;
	/** Held tilt from neutral, degrees. + = right side down. */
	sidePressDeg: number;
	/** Gyroscope about the player's left-right axis (pitch), deg/s. */
	pitchRate: number;
	/** Gyroscope about the screen's up axis (left/right), deg/s. */
	sidePressRate: number;
	/** Gyroscope about the screen normal, Z (twist), deg/s. */
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
