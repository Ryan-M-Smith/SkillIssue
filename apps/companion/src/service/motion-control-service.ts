import type {
	Action,
	GameControls,
	MotionAngles,
	MotionDebug,
	MotionReading,
	Role,
} from "@/types/motion";
import {
	angleDiff,
	angularMagnitude,
	clamp,
	magnitude,
	radToDeg,
} from "@/lib/math/motion";

export type { GameControls, MotionDebug, Role } from "@/types/motion";

/*
 * MOVEMENT PHONE CONTROLS
 *
 * The phone is held tilted, roughly 45° from flat, screen toward the player.
 * Whatever pose it is held still in at start becomes "neutral".
 *
 *   Walk forward   slowly tilt the top away (toward flat) and hold
 *   Walk backward  slowly tilt the top toward you and hold
 *   Strafe         slowly press the right / left side down and hold
 *   Stop           bring the phone back to neutral
 *
 *   Crouch         quick flick forward. Flick forward again to stand up.
 *   Jump           quick flick back. While crouched this only stands up.
 *   Sprint         quick side-to-side shake. Shake again to stop sprinting.
 *
 * Slow tilts move, fast tilts are gestures. One gesture at a time: after one
 * fires, every gesture is locked for `eventLockMs` and until the phone has
 * settled again (back at neutral, or held still), and the motion of the
 * gesture itself never turns into walking.
 *
 * Crouch and sprint are exclusive stances. Changing from one to the other,
 * or jumping out of a crouch, goes through standing (neutral) first.
 */

// Adjustable settings
const settings = {
	calibrationMs: 900,
	calibrationMaxLinear: 0.9,
	calibrationMaxRotation: 13,

	// Walking: slow, held tilt away from neutral
	deadzoneDeg: 8,
	maxWalkTiltDeg: 27,
	walkMaxRate: 120, // deg/s; anything faster is a gesture, not walking

	// Flick (pitch): forward = crouch toggle, back = jump
	flickRate: 200, // deg/s the flick must peak at
	flickMinDeg: 12, // degrees the flick must travel
	flickWindowMs: 250,

	// Shake (side to side): sprint toggle
	shakeRate: 150, // deg/s roll rate that counts as one swing
	shakeAccel: 8, // m/s² sideways that counts as one swing
	shakeSwings: 3, // alternating swings needed
	shakeWindowMs: 700,

	// One event at a time
	eventLockMs: 1000,
	settleRate: 40, // deg/s; slower than this is "still"
	settleAccel: 1.5, // m/s²; less hand movement than this is "still"
	settleNeutralMs: 150, // still at neutral this long re-arms
	settleHeldMs: 400, // still anywhere else this long re-arms

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

// Change signs if motion directions are reversed.
// DeviceMotion beta is 0° flat and 90° upright, so tilting the top away
// (forward) lowers it: forward needs -1.
const axes = {
	moveForwardSign: -1,
	moveRightSign: 1,
	gunnerYawSign: 1,
	gunnerPitchSign: -1,
	forwardJabZSign: -1,
};

// Convert tilt angle into WASD-style movement
function tiltToMovement(degrees: number) {
	if (Math.abs(degrees) < settings.deadzoneDeg) {
		return 0;
	}

	const intensity =
		(Math.abs(degrees) - settings.deadzoneDeg) /
		(settings.maxWalkTiltDeg - settings.deadzoneDeg);

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
		sprintPhase: "off",
		gesture: "armed",
		strafeMeters: 0,
		positionTracking: "missing",
	};
}

/** Counts back-and-forth swings of a signal within a time window. */
class SwingCounter {
	private times: number[] = [];
	private lastSign = 0;

	update(value: number, threshold: number, now: number, windowMs: number) {
		this.times = this.times.filter((t) => now - t <= windowMs);

		if (this.times.length === 0) {
			this.lastSign = 0;
		}

		if (Math.abs(value) >= threshold) {
			const sign = Math.sign(value);

			if (sign !== this.lastSign) {
				this.times.push(now);
				this.lastSign = sign;
			}
		}

		return this.times.length;
	}

	reset() {
		this.times = [];
		this.lastSign = 0;
	}
}

type Flick = {
	dir: 1 | -1; // +1 forward, -1 back
	startDeg: number;
	peakRate: number;
	lastFastAt: number;
};

export class MotionController {
	private calibrationSince: number | null = null;
	private neutral: MotionAngles | null = null;

	// Movement role
	private crouching = false;
	private sprinting = false;
	private lockedUntil = 0;
	private settled = true;
	private settleSince: number | null = null;
	private last: { at: number; forwardDeg: number; rightDeg: number } | null =
		null;
	private forwardRate = 0;
	private rightRate = 0;
	private flick: Flick | null = null;
	private rollSwings = new SwingCounter();
	private sideSwings = new SwingCounter();
	private lastMove = { x: 0, y: 0 };

	// Gunner role
	private armed = false;
	private gunnerLockedUntil = 0;
	private stillSince: number | null = null;
	private aimFrozenUntil = 0;

	private debug: MotionDebug = emptyDebug();

	constructor(private readonly role: Role) {}

	// Recalibrate when necessary
	reset() {
		this.calibrationSince = null;
		this.neutral = null;

		this.crouching = false;
		this.sprinting = false;
		this.lockedUntil = 0;
		this.settled = true;
		this.settleSince = null;
		this.last = null;
		this.forwardRate = 0;
		this.rightRate = 0;
		this.flick = null;
		this.rollSwings.reset();
		this.sideSwings.reset();
		this.lastMove = { x: 0, y: 0 };

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
		const linear = reading.acceleration;
		const gyro = reading.rotationRate;

		const linearMagnitude = linear ? magnitude(linear) : Infinity;
		const angularSpeed = gyro ? angularMagnitude(gyro) : Infinity;

		// STEP 1: AUTOMATIC CALIBRATION
		// Phone must remain still before controls activate.
		if (!this.neutral) {
			if (
				linearMagnitude < settings.calibrationMaxLinear &&
				angularSpeed < settings.calibrationMaxRotation
			) {
				if (this.calibrationSince === null) {
					this.calibrationSince = now;
				}

				if (now - this.calibrationSince >= settings.calibrationMs) {
					this.neutral = { ...reading.rotation };
					this.armed = true;
				}
			} else {
				this.calibrationSince = null;
			}

			return {
				...emptyControls,
				ready: this.neutral !== null,
			};
		}

		this.debug.calibration = "ready";

		return this.role === "movement"
			? this.processMovement(reading, this.neutral, now, linearMagnitude)
			: this.processGunner(reading, now, linearMagnitude, angularSpeed);
	}

	// -------------------- MOVEMENT PHONE --------------------

	private processMovement(
		reading: MotionReading,
		neutral: MotionAngles,
		now: number,
		linearMagnitude: number
	): GameControls {
		const forwardDeg =
			axes.moveForwardSign *
			radToDeg(angleDiff(reading.rotation.beta, neutral.beta));

		const rightDeg =
			axes.moveRightSign *
			radToDeg(angleDiff(reading.rotation.gamma, neutral.gamma));

		const previousForwardDeg = this.last?.forwardDeg ?? forwardDeg;
		this.updateRates(forwardDeg, rightDeg, now);

		const fr = this.forwardRate;
		const rr = this.rightRate;
		const turning = Math.max(Math.abs(fr), Math.abs(rr));

		this.updateSettled(forwardDeg, rightDeg, turning, linearMagnitude, now);
		this.trackFlick(fr, rr, previousForwardDeg, now);

		// Sideways shake: roll swings (only while roll dominates, so a
		// pitch flick never counts) or sideways hand swings.
		const rollSwings = this.rollSwings.update(
			Math.abs(rr) > Math.abs(fr) ? rr : 0,
			settings.shakeRate,
			now,
			settings.shakeWindowMs
		);

		const sideSwings = this.sideSwings.update(
			reading.acceleration?.x ?? 0,
			settings.shakeAccel,
			now,
			settings.shakeWindowMs
		);

		// STEP 2: ONE GESTURE AT A TIME
		let action: Action = null;
		const armed = now >= this.lockedUntil && this.settled;

		if (armed) {
			const flick = this.flick;

			if (
				flick &&
				flick.peakRate >= settings.flickRate &&
				(forwardDeg - flick.startDeg) * flick.dir >= settings.flickMinDeg
			) {
				action = flick.dir > 0 ? this.toggleCrouch() : this.jump();
			} else if (
				rollSwings >= settings.shakeSwings ||
				sideSwings >= settings.shakeSwings
			) {
				action = this.toggleSprint();
			}

			if (action) {
				this.lockedUntil = now + settings.eventLockMs;
				this.settled = false;
				this.settleSince = null;
				this.flick = null;
				this.rollSwings.reset();
				this.sideSwings.reset();
			}
		}

		// STEP 3: WALK / STRAFE FROM SLOW, HELD TILT
		let move = this.lastMove;
		const shaking = Math.max(rollSwings, sideSwings) > 0;

		if (!this.settled) {
			// The gesture and the swing back to neutral never walk.
			move = { x: 0, y: 0 };
		} else if (
			turning < settings.walkMaxRate &&
			!this.flick &&
			!shaking
		) {
			move = {
				x: tiltToMovement(rightDeg),
				y: tiltToMovement(forwardDeg),
			};
		}
		// Otherwise a fast motion is in progress: hold the last movement
		// until we know whether it is a gesture.

		this.lastMove = move;

		this.debug.pitchDeg = forwardDeg;
		this.debug.sidePressDeg = rightDeg;
		this.debug.pitchRate = fr;
		this.debug.sidePressRate = rr;
		this.debug.gesture =
			now >= this.lockedUntil && this.settled ? "armed" : "locked";
		this.debug.sprintPhase = this.sprinting
			? "on"
			: shaking
				? "shaking"
				: "off";

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

	// Rates come from the same fused angles that drive walking, so a flick's
	// direction always agrees with the walking direction on every platform.
	private updateRates(forwardDeg: number, rightDeg: number, now: number) {
		if (this.last) {
			const dt = clamp((now - this.last.at) / 1000, 0.01, 0.1);
			const smoothing = 0.5;

			this.forwardRate +=
				smoothing *
				((forwardDeg - this.last.forwardDeg) / dt - this.forwardRate);
			this.rightRate +=
				smoothing * ((rightDeg - this.last.rightDeg) / dt - this.rightRate);
		}

		this.last = { at: now, forwardDeg, rightDeg };
	}

	// After a gesture: re-arm once the phone is still at neutral, or held
	// still somewhere else for a little longer (e.g. jumping while walking).
	private updateSettled(
		forwardDeg: number,
		rightDeg: number,
		turning: number,
		linearMagnitude: number,
		now: number
	) {
		if (this.settled) {
			return;
		}

		if (
			turning >= settings.settleRate ||
			linearMagnitude >= settings.settleAccel
		) {
			this.settleSince = null;
			return;
		}

		if (this.settleSince === null) {
			this.settleSince = now;
		}

		const atNeutral =
			Math.abs(forwardDeg) < settings.deadzoneDeg &&
			Math.abs(rightDeg) < settings.deadzoneDeg;

		const needed = atNeutral
			? settings.settleNeutralMs
			: settings.settleHeldMs;

		if (now - this.settleSince >= needed) {
			this.settled = true;
			this.settleSince = null;
			this.flick = null;
			this.rollSwings.reset();
			this.sideSwings.reset();
		}
	}

	private trackFlick(
		fr: number,
		rr: number,
		previousForwardDeg: number,
		now: number
	) {
		if (Math.abs(fr) >= settings.walkMaxRate && Math.abs(fr) >= Math.abs(rr)) {
			const dir = fr > 0 ? 1 : -1;

			if (!this.flick || this.flick.dir !== dir) {
				this.flick = {
					dir,
					startDeg: previousForwardDeg,
					peakRate: 0,
					lastFastAt: now,
				};
			}

			this.flick.peakRate = Math.max(this.flick.peakRate, Math.abs(fr));
			this.flick.lastFastAt = now;
		} else if (
			this.flick &&
			now - this.flick.lastFastAt > settings.flickWindowMs
		) {
			this.flick = null;
		}
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
		now: number,
		linearMagnitude: number,
		angularSpeed: number
	): GameControls {
		const linear = reading.acceleration;
		const gyro = reading.rotationRate;

		this.debug.pitchRate = gyro?.beta ?? 0;
		this.debug.sidePressRate = gyro?.gamma ?? 0;

		let action: Action = null;

		// Re-arm: prevent returning the phone from firing another shot.
		if (!this.armed) {
			const settled =
				now >= this.gunnerLockedUntil &&
				linearMagnitude < settings.rearmAcceleration &&
				angularSpeed < settings.rearmRotation;

			if (settled) {
				if (this.stillSince === null) {
					this.stillSince = now;
				}

				if (now - this.stillSince >= settings.rearmStillMs) {
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
				this.aimFrozenUntil = now + settings.aimFreezeAfterShotMs;

				this.armed = false;
				this.gunnerLockedUntil = now + settings.gestureCooldownMs;
				this.stillSince = null;
			}
		}

		this.debug.gesture = this.armed ? "armed" : "locked";

		const output: GameControls = {
			...emptyControls,
			ready: true,
			action,
		};

		if (gyro && now >= this.aimFrozenUntil) {
			output.lookX = gyroToMovement(axes.gunnerYawSign * gyro.gamma);
			output.lookY = gyroToMovement(axes.gunnerPitchSign * gyro.beta);
		}

		return output;
	}
}
