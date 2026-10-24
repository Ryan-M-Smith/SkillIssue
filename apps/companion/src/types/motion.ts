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

export type Action = "jump" | "crouch" | "shoot" | null;

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