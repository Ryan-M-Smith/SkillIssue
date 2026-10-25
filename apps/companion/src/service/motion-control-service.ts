import type {
	Action,
	GameControls,
	Grip,
	MotionDebug,
	MotionReading,
	MotionVector,
	Role,
} from "@/types/motion";
import {
	clamp,
	cross,
	deviceRotationRate,
	dot,
	magnitude,
	normalize,
	radToDeg,
	scale,
} from "@/lib/math/motion";

export type { GameControls, MotionDebug, Role } from "@/types/motion";

/*
 * MOVEMENT PHONE
 *
 * Hold the phone in landscape with both hands, like a controller, tilted
 * about 45° with the screen toward you. (Portrait works too.) The pose it
 * is held still in at start is neutral.
 *
 *   Pitch   slow tilt and hold    walk forward (top edge away) / back
 *           quick flick forward   crouch, flick again to stand up
 *           quick flick back      jump (while crouched: stand up)
 *   Yaw     slow tilt and hold    strafe right (right end down) / left
 *   Roll/Z  comfortable 32° twist sprint on/off, return to neutral to re-arm
 *
 * WORKS IN ANY GRIP
 *
 * The phone's own X/Y axes swap places between portrait and landscape, so
 * nothing here assumes a grip. During calibration, gravity shows which way
 * is up on the screen. From that we build the player's axes in the phone's
 * frame:
 *
 *   up     the screen's up direction        (portrait: +Y, landscape: ±X)
 *   right  the player's left-right axis     up × Z, always level
 *   away   level, pointing away from you    up-world × right
 *
 * Held tilts are measured from gravity: how far it has turned, since
 * neutral, about `right` (forward/back) and about `away` (left/right).
 *
 * Gestures come from the gyroscope, projected onto `right`, `up` and the
 * screen normal Z. A fast motion starts a "burst"; its rotation is added up
 * per axis using the sensor's own timestamps. As soon as one axis clearly
 * dominates and has turned far and fast enough, that gesture fires. A burst
 * fires at most once, then gestures are locked briefly, and the gesture's
 * own motion never turns into walking.
 *
 * Crouch and sprint are exclusive stances; starting one ends the other.
 */

// Adjustable settings
const settings = {
	// Neutral: phone held still this long at start
	calibrationMs: 450,
	calibrationMaxRate: 15, // deg/s

	// Walking: held tilt away from neutral
	deadzoneDeg: 5,
	fullSpeedDeg: 20,

	// Gravity smoothing when the phone doesn't report linear acceleration
	gravitySmoothing: 0.3,

	// Bursts: a fast motion in progress
	burstStartRate: 110, // deg/s
	burstEndRate: 50, // deg/s
	burstQuietMs: 80, // below burstEndRate this long ends the burst
	burstMaxMs: 350,
	dominance: 1.5, // winning axis must turn this many times more than the others

	// Pitch flick: jump / crouch
	flickRate: 135, // deg/s peak
	flickMinDeg: 11,

	// Wheel gestures use a held angle, so they work without a violent flick.
	wheelTriggerDeg: 32,
	wheelRearmDeg: 12,
	wheelCooldownMs: 350,

	// One gesture at a time
	eventLockMs: 350,
	afterGestureMs: 180, // suppress the gesture's return swing

	// Gunner
	jabThreshold: 3.4,
	liftThreshold: 4.2,
	gestureMaxRotation: 110,
	gestureCooldownMs: 230,
	rearmStillMs: 90,
	rearmAcceleration: 1.8,
	rearmRotation: 40,
	aimFreezeAfterShotMs: 70,
	aimMaxRate: 130,
	aimDeadzone: 1.5,
};

// Flip a sign here if a direction comes out reversed on a real phone.
const axes = {
	forwardSign: 1, // + = top edge away walks forward
	rightSign: 1, // + = right end down strafes right
	gunnerYawSign: 1, // lookX from rotation about the screen's up axis
	gunnerPitchSign: -1, // lookY from rotation about the left-right axis
	forwardJabZSign: -1,
};

/** The player's axes, in the phone's own frame, worked out at calibration. */
export type Frame = {
	grip: Grip;
	down: MotionVector; // gravity direction at neutral
	up: MotionVector; // screen's up direction, in the screen plane
	right: MotionVector; // player's left-right axis
	away: MotionVector; // level, pointing away from the player
};

const zAxis: MotionVector = { x: 0, y: 0, z: 1 };

function buildFrame(down: MotionVector): Frame {
	// Screen's up = world up, projected onto the screen plane.
	const inPlane = { x: -down.x, y: -down.y, z: 0 };
	const flat = magnitude(inPlane) < 0.25;
	const up = flat ? { x: 0, y: 1, z: 0 } : normalize(inPlane);
	const right = cross(up, zAxis);
	const away = normalize(cross(scale(down, -1), right));

	let grip: Grip;

	if (flat) {
		grip = "flat";
	} else if (Math.abs(up.x) > Math.abs(up.y)) {
		grip = "landscape";
	} else {
		grip = up.y > 0 ? "portrait" : "upside down";
	}

	return { grip, down, up, right, away };
}

// Device rotation (degrees) about `axis` that turned gravity from `from` to `to`.
function rotationAbout(
	from: MotionVector,
	to: MotionVector,
	axis: MotionVector
) {
	// Gravity turns the opposite way to the phone, hence the minus.
	return -radToDeg(Math.asin(clamp(dot(cross(from, to), axis))));
}

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
		grip: "portrait",
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

/** Gyroscope rates about the player's axes: x = pitch, y = side, z = twist. */
type PlayerRates = MotionVector;

type Burst = {
	startedAt: number;
	lastFastAt: number;
	turned: PlayerRates; // degrees turned about each axis during the burst
	peak: PlayerRates; // fastest rate about each axis, deg/s
	moveBefore: Move;
	fired: boolean;
};

type Move = { x: number; y: number };

const still: Move = { x: 0, y: 0 };

export class MotionController {
	private calibrationSince: number | null = null;
	private gravitySum: MotionVector = { x: 0, y: 0, z: 0 };
	private frame: Frame | null = null;
	private gravity: MotionVector | null = null;
	private lastSampleAt: number | null = null;

	// Movement role
	private crouching = false;
	private sprinting = false;
	private burst: Burst | null = null;
	private lockedUntil = 0;
	private quietUntil = 0;
	private lastMove: Move = still;
	private wheelArmed = true;
	private wheelLockedUntil = 0;

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
		this.gravitySum = { x: 0, y: 0, z: 0 };
		this.frame = null;
		this.gravity = null;
		this.lastSampleAt = null;

		this.crouching = false;
		this.sprinting = false;
		this.burst = null;
		this.lockedUntil = 0;
		this.quietUntil = 0;
		this.lastMove = still;
		this.wheelArmed = true;
		this.wheelLockedUntil = 0;

		this.armed = false;
		this.gunnerLockedUntil = 0;
		this.stillSince = null;
		this.aimFrozenUntil = 0;

		this.debug = emptyDebug();
	}

	getDebug(): MotionDebug {
		return { ...this.debug };
	}

	/**
	 * The calibrated player frame and the current gravity direction, both in
	 * the phone's own frame. Null until calibrated. For debug views.
	 */
	getOrientation(): { frame: Frame; gravity: MotionVector } | null {
		if (!this.frame || !this.gravity) {
			return null;
		}

		return { frame: { ...this.frame }, gravity: { ...this.gravity } };
	}

	process(reading: MotionReading, now = Date.now()): GameControls {
		const total = reading.accelerationIncludingGravity;
		const finiteVector = (v: MotionVector) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
		if (!finiteVector(total) || magnitude(total) < 0.1 ||
			(reading.acceleration && !finiteVector(reading.acceleration)) ||
			(reading.rotationRate && ![reading.rotationRate.alpha, reading.rotationRate.beta, reading.rotationRate.gamma].every(Number.isFinite))) {
			return { ...emptyControls, ready: this.frame !== null };
		}
		// Prefer the sensor's own clock: JS callbacks can arrive in bunches.
		const stamp =
			reading.rotationRate?.timestamp ?? reading.rotation.timestamp;
		const t = typeof stamp === "number" && Number.isFinite(stamp) ? stamp * 1000 : now;
		const dt =
			this.lastSampleAt === null
				? 0
				: clamp((t - this.lastSampleAt) / 1000, 0, 0.1);
		this.lastSampleAt = t;

		const gravity = this.updateGravity(reading);

		const gyro: MotionVector | null = reading.rotationRate
			? deviceRotationRate(reading.rotationRate, this.platform)
			: null;
		const angularSpeed = gyro ? magnitude(gyro) : 0;

		// STEP 1: AUTOMATIC CALIBRATION
		// Hold still: gravity then gives neutral and the grip.
		if (!this.frame) {
			if (angularSpeed < settings.calibrationMaxRate) {
				if (this.calibrationSince === null) {
					this.calibrationSince = t;
					this.gravitySum = { x: 0, y: 0, z: 0 };
				}

				this.gravitySum = {
					x: this.gravitySum.x + gravity.x,
					y: this.gravitySum.y + gravity.y,
					z: this.gravitySum.z + gravity.z,
				};

				if (t - this.calibrationSince >= settings.calibrationMs) {
					this.frame = buildFrame(normalize(this.gravitySum));
					this.armed = true;
					this.debug.calibration = "ready";
					this.debug.grip = this.frame.grip;
				}
			} else {
				this.calibrationSince = null;
			}

			return {
				...emptyControls,
				ready: this.frame !== null,
			};
		}

		const rates: PlayerRates | null = gyro
			? {
					x: dot(gyro, this.frame.right),
					y: dot(gyro, this.frame.up),
					z: gyro.z,
				}
			: null;

		this.debug.pitchRate = rates?.x ?? 0;
		this.debug.sidePressRate = rates?.y ?? 0;
		this.debug.twistRate = rates?.z ?? 0;

		return this.role === "movement"
			? this.processMovement(gravity, this.frame, rates, t, dt)
			: this.processGunner(reading, gravity, this.frame, rates, angularSpeed, t);
	}

	// Unit gravity direction in the phone's frame (points at the ground).
	private updateGravity(reading: MotionReading): MotionVector {
		const total = reading.accelerationIncludingGravity;
		const linear = reading.acceleration;

		if (linear) {
			// Both platforms already separate gravity from hand motion.
			this.gravity = normalize({
				x: total.x - linear.x,
				y: total.y - linear.y,
				z: total.z - linear.z,
			});
		} else {
			// No linear acceleration: smooth out hand motion instead.
			const sample = normalize(total);
			const k = settings.gravitySmoothing;

			this.gravity = this.gravity
				? normalize({
						x: this.gravity.x + k * (sample.x - this.gravity.x),
						y: this.gravity.y + k * (sample.y - this.gravity.y),
						z: this.gravity.z + k * (sample.z - this.gravity.z),
					})
				: sample;
		}

		return this.gravity;
	}

	// -------------------- MOVEMENT PHONE --------------------

	private processMovement(
		gravity: MotionVector,
		frame: Frame,
		rates: PlayerRates | null,
		t: number,
		dt: number
	): GameControls {
		// Rotation about `right` is + when the top edge comes toward you.
		const forwardDeg =
			-axes.forwardSign * rotationAbout(frame.down, gravity, frame.right);

		// Rotation about `away` is + when the right end goes down.
		const rightDeg =
			axes.rightSign * rotationAbout(frame.down, gravity, frame.away);

		const atNeutral =
			Math.abs(forwardDeg) < settings.deadzoneDeg &&
			Math.abs(rightDeg) < settings.deadzoneDeg;

		// STEP 2: GESTURES FROM GYROSCOPE BURSTS
		let action: Action = this.updateWheel(gravity, frame, t)
			? this.toggleSprint()
			: null;
		if (action) {
			this.burst = null;
			this.lockedUntil = t + settings.eventLockMs;
			this.quietUntil = t + settings.afterGestureMs;
		}

		if (rates && !action) {
			action = this.updateBurst(rates, t, dt);
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
		this.debug.burst = this.burst
			? dominantAxisName(this.burst.turned)
			: "none";
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

	private updateBurst(rates: PlayerRates, t: number, dt: number): Action {
		const speed = magnitude(rates);

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
			x: burst.turned.x + rates.x * dt,
			y: burst.turned.y + rates.y * dt,
			z: burst.turned.z + rates.z * dt,
		};
		burst.peak = {
			x: Math.max(burst.peak.x, Math.abs(rates.x)),
			y: Math.max(burst.peak.y, Math.abs(rates.y)),
			z: Math.max(burst.peak.z, Math.abs(rates.z)),
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
		const pitch = Math.abs(burst.turned.x);
		const side = Math.abs(burst.turned.y);
		const twist = Math.abs(burst.turned.z);

		// Pitch flick
		if (
			pitch >= settings.flickMinDeg &&
			burst.peak.x >= settings.flickRate &&
			pitch >= settings.dominance * Math.max(side, twist)
		) {
			// Rotation about `right` is + when the top edge comes toward you.
			const forward = -axes.forwardSign * burst.turned.x > 0;
			return forward ? this.toggleCrouch() : this.jump();
		}

		// Anything else (e.g. a quick left/right tilt) is not a gesture.
		return null;
	}

	/** Angle around the screen normal, with hysteresis to ignore the return swing. */
	private updateWheel(gravity: MotionVector, frame: Frame, t: number): boolean {
		const neutralLength = Math.hypot(frame.down.x, frame.down.y);
		const currentLength = Math.hypot(gravity.x, gravity.y);
		// A face-up phone has no reliable wheel angle; ask for a normal tilted grip.
		if (neutralLength < 0.25 || currentLength < 0.25) return false;
		const angle = Math.abs(radToDeg(Math.atan2(
			frame.down.x * gravity.y - frame.down.y * gravity.x,
			frame.down.x * gravity.x + frame.down.y * gravity.y,
		)));
		if (angle <= settings.wheelRearmDeg && t >= this.wheelLockedUntil) {
			this.wheelArmed = true;
		}
		if (!this.wheelArmed || t < this.wheelLockedUntil || angle < settings.wheelTriggerDeg) return false;
		this.wheelArmed = false;
		this.wheelLockedUntil = t + settings.wheelCooldownMs;
		return true;
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
		gravity: MotionVector,
		frame: Frame,
		rates: PlayerRates | null,
		angularSpeed: number,
		t: number
	): GameControls {
		// Browsers can omit linear acceleration; subtract smoothed gravity instead.
		const total = reading.accelerationIncludingGravity;
		const linear = reading.acceleration ?? {
			x: total.x - gravity.x * 9.80665,
			y: total.y - gravity.y * 9.80665,
			z: total.z - gravity.z * 9.80665,
		};
		const linearMagnitude = magnitude(linear);

		let action: Action = this.updateWheel(gravity, frame, t) ? "weapon_next" : null;

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
			!action &&
			angularSpeed < settings.gestureMaxRotation
		) {
			const forwardImpulse = axes.forwardJabZSign * linear.z;

			const liftImpulse = dot(linear, scale(frame.down, -1));
			if (Math.abs(forwardImpulse) >= settings.jabThreshold && Math.abs(forwardImpulse) > 0.75 * linearMagnitude) {
				action = forwardImpulse > 0 ? "shoot" : "scope";
			} else if (liftImpulse >= settings.liftThreshold && liftImpulse > 0.75 * linearMagnitude) {
				action = "reload";
			}
		}
		if (action) {
			// Temporarily suppress camera jitter and ignore the return movement.
			this.aimFrozenUntil = t + settings.aimFreezeAfterShotMs;
			this.armed = false;
			this.gunnerLockedUntil = t + settings.gestureCooldownMs;
			this.stillSince = null;
		}

		this.debug.gesture = this.armed ? "armed" : "locked";

		const output: GameControls = {
			...emptyControls,
			ready: true,
			action,
		};

		if (rates && t >= this.aimFrozenUntil) {
			output.lookX = gyroToMovement(axes.gunnerYawSign * rates.y);
			output.lookY = gyroToMovement(axes.gunnerPitchSign * rates.x);
		}

		return output;
	}
}

function dominantAxisName(v: PlayerRates): MotionDebug["burst"] {
	const x = Math.abs(v.x);
	const y = Math.abs(v.y);
	const z = Math.abs(v.z);

	if (x >= y && x >= z) return "pitch";
	if (y >= z) return "side";
	return "twist";
}
