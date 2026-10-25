import type {
	Action,
	GameControls,
	MotionAngles,
	MotionDebug,
	MotionReading,
	MotionVector,
	Role,
} from "@/types/motion";
import {
	angleDiff,
	clamp,
	deviceRotationRate,
	magnitude,
	radToDeg,
} from "@/lib/math/motion";

export type { GameControls, MotionDebug, Role } from "@/types/motion";

/*
 * MOVEMENT PHONE
 *
 * Hold the phone at about 45°, screen toward you. The pose it is held still
 * in at start is neutral. Each control lives on one of the phone's own axes:
 *
 *   Pitch / X   slow tilt and hold    walk forward (top away) / back
 *               quick flick forward   crouch, flick again to stand up
 *               quick flick back      jump (while crouched: stand up)
 *   Yaw / Y     slow tilt and hold    strafe right (right side down) / left
 *   Roll / Z    quick twist           sprint on, twist again for off
 *
 * HOW IT DETECTS THEM
 *
 * Held tilts come from the phone's fused orientation, relative to neutral.
 *
 * Gestures come from the gyroscope. Any fast motion starts a "burst". During
 * the burst the gyroscope's rotation is added up per axis (using the
 * sensor's own timestamps, not the JS clock). As soon as one axis clearly
 * dominates and has turned far and fast enough, that axis's gesture fires.
 * A burst can fire at most once, so the swing back to neutral never counts
 * as a second gesture. After a gesture there is a short lock, and the
 * gesture's own motion never turns into walking.
 *
 * Crouch and sprint are exclusive stances; starting one ends the other.
 */

// Adjustable settings
const settings = {
	// Neutral: phone held still this long at start
	calibrationMs: 700,
	calibrationMaxRate: 15, // deg/s

	// Walking: held tilt away from neutral
	deadzoneDeg: 8,
	fullSpeedDeg: 25,

	// Bursts: a fast motion in progress
	burstStartRate: 80, // deg/s
	burstEndRate: 50, // deg/s
	burstQuietMs: 80, // below burstEndRate this long ends the burst
	burstMaxMs: 800,
	dominance: 1.5, // winning axis must turn this many times more than the others

	// Pitch flick (X): jump / crouch
	flickRate: 150, // deg/s peak
	flickMinDeg: 12,

	// Twist (Z): sprint
	twistRate: 150, // deg/s peak
	twistMinDeg: 20,

	// One gesture at a time
	eventLockMs: 1000,
	afterGestureMs: 500, // no walking this long after a gesture, unless back at neutral

	// Gunner
	jabThreshold: 5.5,
	gestureMaxRotation: 110,
	gestureCooldownMs: 650,
	rearmStillMs: 400,
	rearmAcceleration: 1.2,
	rearmRotation: 25,
	aimFreezeAfterShotMs: 110,
	aimMaxRate: 130,
	aimDeadzone: 3,
};

// Flip a sign here if a direction comes out reversed on a real phone.
const axes = {
	// rotation.beta is 0° flat and 90° upright on iOS and Android, so tilting
	// the top away (forward) lowers it; gyro X is negative for the same motion.
	forwardSign: -1,
	// rotation.gamma grows as the right side goes down.
	rightSign: 1,
	gunnerYawSign: 1, // lookX from gyro Y
	gunnerPitchSign: -1, // lookY from gyro X
	forwardJabZSign: -1,
};

// Convert held tilt into WASD-style movement
function tiltToMovement(degrees: number) {
	if (Math.abs(degrees) < settings.deadzoneDeg) {
		return 0;
	}

	const intensity =
		(Math.abs(degrees) - settings.deadzoneDeg) /
		(settings.fullSpeedDeg - settings.deadzoneDeg);

	return Math.sign(degrees) * clamp(intensity);
}

// Convert gyroscope angular velocity into camera input
function gyroToMovement(degreesPerSecond: number) {
	return Math.abs(degreesPerSecond) >= settings.aimDeadzone
		? clamp(degreesPerSecond / settings.aimMaxRate)
		: 0;
}

export const emptyControls: GameControls = {
	ready: false,
	moveX: 0,
	moveY: 0,
	sprint: false,
	crouch: false,
	lookX: 0,
	lookY: 0,
	action: null,
};

function emptyDebug(): MotionDebug {
	return {
		calibration: "calibrating",
		pitchDeg: 0,
		sidePressDeg: 0,
		pitchRate: 0,
		sidePressRate: 0,
		twistRate: 0,
		burst: "none",
		sprintPhase: "off",
		gesture: "armed",
	};
}

type Burst = {
	startedAt: number;
	lastFastAt: number;
	turned: MotionVector; // degrees turned about each axis during the burst
	peak: MotionVector; // fastest rate about each axis, deg/s
	moveBefore: { x: number; y: number };
	fired: boolean;
};

type Move = { x: number; y: number };

const still: Move = { x: 0, y: 0 };

export class MotionController {
	private calibrationSince: number | null = null;
	private neutral: MotionAngles | null = null;
	private lastSampleAt: number | null = null;

	// Movement role
	private crouching = false;
	private sprinting = false;
	private burst: Burst | null = null;
	private lockedUntil = 0;
	private quietUntil = 0;
	private lastMove: Move = still;

	// Gunner role
	private armed = false;
	private gunnerLockedUntil = 0;
	private stillSince: number | null = null;
	private aimFrozenUntil = 0;

	private debug: MotionDebug = emptyDebug();

	/**
	 * @param role     which phone this is
	 * @param platform Platform.OS; expo-sensors orders the gyroscope
	 *                 axes differently on each platform
	 */
	constructor(
		private readonly role: Role,
		private readonly platform: string = "ios"
	) {}

	// Recalibrate when necessary
	reset() {
		this.calibrationSince = null;
		this.neutral = null;
		this.lastSampleAt = null;

		this.crouching = false;
		this.sprinting = false;
		this.burst = null;
		this.lockedUntil = 0;
		this.quietUntil = 0;
		this.lastMove = still;

		this.armed = false;
		this.gunnerLockedUntil = 0;
		this.stillSince = null;
		this.aimFrozenUntil = 0;

		this.debug = emptyDebug();
	}

	getDebug(): MotionDebug {
		return { ...this.debug };
	}

	process(reading: MotionReading, now = Date.now()): GameControls {
		// Prefer the sensor's own clock: JS callbacks can arrive in bunches.
		const stamp =
			reading.rotationRate?.timestamp ?? reading.rotation.timestamp;
		const t = typeof stamp === "number" ? stamp * 1000 : now;
		const dt =
			this.lastSampleAt === null
				? 0
				: clamp((t - this.lastSampleAt) / 1000, 0, 0.1);
		this.lastSampleAt = t;

		const gyro: MotionVector | null = reading.rotationRate
			? deviceRotationRate(reading.rotationRate, this.platform)
			: null;
		const angularSpeed = gyro ? magnitude(gyro) : Infinity;

		this.debug.pitchRate = gyro?.x ?? 0;
		this.debug.sidePressRate = gyro?.y ?? 0;
		this.debug.twistRate = gyro?.z ?? 0;

		// STEP 1: AUTOMATIC CALIBRATION
		// Phone must be held still before controls activate.
		if (!this.neutral) {
			if (angularSpeed < settings.calibrationMaxRate) {
				if (this.calibrationSince === null) {
					this.calibrationSince = t;
				}

				if (t - this.calibrationSince >= settings.calibrationMs) {
					this.neutral = { ...reading.rotation };
					this.armed = true;
					this.debug.calibration = "ready";
				}
			} else {
				this.calibrationSince = null;
			}

			return {
				...emptyControls,
				ready: this.neutral !== null,
			};
		}

		return this.role === "movement"
			? this.processMovement(reading, this.neutral, gyro, t, dt)
			: this.processGunner(reading, gyro, angularSpeed, t);
	}

	// -------------------- MOVEMENT PHONE --------------------

	private processMovement(
		reading: MotionReading,
		neutral: MotionAngles,
		gyro: MotionVector | null,
		t: number,
		dt: number
	): GameControls {
		const forwardDeg =
			axes.forwardSign *
			radToDeg(angleDiff(reading.rotation.beta, neutral.beta));

		const rightDeg =
			axes.rightSign *
			radToDeg(angleDiff(reading.rotation.gamma, neutral.gamma));

		const atNeutral =
			Math.abs(forwardDeg) < settings.deadzoneDeg &&
			Math.abs(rightDeg) < settings.deadzoneDeg;

		// STEP 2: GESTURES FROM GYROSCOPE BURSTS
		let action: Action = null;

		if (gyro) {
			action = this.updateBurst(gyro, t, dt);
		}

		// STEP 3: WALK / STRAFE FROM HELD TILT
		let move: Move;

		if (this.burst) {
			// Mid-motion: keep what we had until we know it isn't a gesture.
			move = this.burst.fired ? still : this.burst.moveBefore;
		} else if (t < this.quietUntil && !atNeutral) {
			// Just after a gesture: the swing back to neutral never walks.
			move = still;
		} else {
			this.quietUntil = 0;
			move = {
				x: tiltToMovement(rightDeg),
				y: tiltToMovement(forwardDeg),
			};
		}

		this.lastMove = move;

		this.debug.pitchDeg = forwardDeg;
		this.debug.sidePressDeg = rightDeg;
		this.debug.burst = this.burst ? dominantAxisName(this.burst.turned) : "none";
		this.debug.gesture = t >= this.lockedUntil ? "armed" : "locked";
		this.debug.sprintPhase = this.sprinting ? "on" : "off";

		return {
			...emptyControls,
			ready: true,
			action,
			moveX: move.x,
			moveY: move.y,
			crouch: this.crouching,
			sprint: this.sprinting,
		};
	}

	private updateBurst(gyro: MotionVector, t: number, dt: number): Action {
		const speed = magnitude(gyro);

		if (!this.burst) {
			if (speed < settings.burstStartRate) {
				return null;
			}

			this.burst = {
				startedAt: t,
				lastFastAt: t,
				turned: { x: 0, y: 0, z: 0 },
				peak: { x: 0, y: 0, z: 0 },
				moveBefore: this.lastMove,
				fired: false,
			};
		}

		const burst = this.burst;

		burst.turned = {
			x: burst.turned.x + gyro.x * dt,
			y: burst.turned.y + gyro.y * dt,
			z: burst.turned.z + gyro.z * dt,
		};
		burst.peak = {
			x: Math.max(burst.peak.x, Math.abs(gyro.x)),
			y: Math.max(burst.peak.y, Math.abs(gyro.y)),
			z: Math.max(burst.peak.z, Math.abs(gyro.z)),
		};

		if (speed >= settings.burstEndRate) {
			burst.lastFastAt = t;
		}

		let action: Action = null;

		if (!burst.fired && t >= this.lockedUntil) {
			action = this.classify(burst);

			if (action) {
				burst.fired = true;
				this.lockedUntil = t + settings.eventLockMs;
			}
		}

		const ended =
			t - burst.lastFastAt >= settings.burstQuietMs ||
			t - burst.startedAt >= settings.burstMaxMs;

		if (ended) {
			if (burst.fired) {
				this.quietUntil = t + settings.afterGestureMs;
			}

			this.burst = null;
		}

		return action;
	}

	// Which gesture, if any, this burst is so far.
	private classify(burst: Burst): Action {
		const x = Math.abs(burst.turned.x);
		const y = Math.abs(burst.turned.y);
		const z = Math.abs(burst.turned.z);

		// Pitch flick (X)
		if (
			x >= settings.flickMinDeg &&
			burst.peak.x >= settings.flickRate &&
			x >= settings.dominance * Math.max(y, z)
		) {
			// Gyro X is positive when the top comes toward you.
			const forward = axes.forwardSign * burst.turned.x > 0;
			return forward ? this.toggleCrouch() : this.jump();
		}

		// Twist (Z)
		if (
			z >= settings.twistMinDeg &&
			burst.peak.z >= settings.twistRate &&
			z >= settings.dominance * Math.max(x, y)
		) {
			return this.toggleSprint();
		}

		// A fast tilt about Y is just a quick strafe: no gesture.
		return null;
	}

	private toggleCrouch(): Action {
		this.crouching = !this.crouching;

		if (this.crouching) {
			this.sprinting = false;
		}

		return "crouch";
	}

	private jump(): Action {
		if (this.crouching) {
			this.crouching = false;
			return "stand";
		}

		return "jump";
	}

	private toggleSprint(): Action {
		this.sprinting = !this.sprinting;

		if (this.sprinting) {
			this.crouching = false;
		}

		return "sprint";
	}

	// -------------------- GUNNER PHONE --------------------

	private processGunner(
		reading: MotionReading,
		gyro: MotionVector | null,
		angularSpeed: number,
		t: number
	): GameControls {
		const linear = reading.acceleration;
		const linearMagnitude = linear ? magnitude(linear) : Infinity;

		let action: Action = null;

		// Re-arm: prevent returning the phone from firing another shot.
		if (!this.armed) {
			const settled =
				t >= this.gunnerLockedUntil &&
				linearMagnitude < settings.rearmAcceleration &&
				angularSpeed < settings.rearmRotation;

			if (settled) {
				if (this.stillSince === null) {
					this.stillSince = t;
				}

				if (t - this.stillSince >= settings.rearmStillMs) {
					this.armed = true;
				}
			} else {
				this.stillSince = null;
			}
		}

		// Forward jab to shoot
		if (
			this.armed &&
			linear &&
			angularSpeed < settings.gestureMaxRotation
		) {
			const forwardImpulse = axes.forwardJabZSign * linear.z;

			if (
				forwardImpulse >= settings.jabThreshold &&
				forwardImpulse > 0.8 * linearMagnitude
			) {
				action = "shoot";

				// Temporarily suppress camera jitter
				this.aimFrozenUntil = t + settings.aimFreezeAfterShotMs;

				this.armed = false;
				this.gunnerLockedUntil = t + settings.gestureCooldownMs;
				this.stillSince = null;
			}
		}

		this.debug.gesture = this.armed ? "armed" : "locked";

		const output: GameControls = {
			...emptyControls,
			ready: true,
			action,
		};

		if (gyro && t >= this.aimFrozenUntil) {
			output.lookX = gyroToMovement(axes.gunnerYawSign * gyro.y);
			output.lookY = gyroToMovement(axes.gunnerPitchSign * gyro.x);
		}

		return output;
	}
}

function dominantAxisName(v: MotionVector): MotionDebug["burst"] {
	const x = Math.abs(v.x);
	const y = Math.abs(v.y);
	const z = Math.abs(v.z);

	if (x >= y && x >= z) return "pitch";
	if (y >= z) return "side";
	return "twist";
}
