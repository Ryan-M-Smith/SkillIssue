import type {
	Action,
	GameControls,
	Grip,
	MotionDebug,
	MotionReading,
	MotionVector,
	Role,
} from "@/types/motion";

import { clamp, cross, deviceRotationRate, dot, magnitude, normalize, radToDeg, scale } from "@/lib/math/motion";

export type { GameControls, MotionDebug, Role } from "@/types/motion";

/*
 * MOVEMENT PHONE (Runner)
 *
 * Hold the phone sideways like a controller, screen toward you, tilted back at
 * whatever angle is comfortable. The pose it is held in at the start is neutral.
 *
 *   tilt top away / toward you      walk forward / back     (held, 5°–20°)
 *   tip one end down                strafe                  (held, 3.5°–12°)
 *   quick flick forward and back    crouch on / off
 *   quick flick back and forward    jump (while crouched: stand up)
 *   twist ~30° like a wheel         sprint on / off, return to center to re-arm
 *
 * WHY TWIST AND STRAFE NEED THE GYROSCOPE
 *
 * Gravity only shows two angles: pitch, and how far gravity has turned in the
 * screen plane. Tipping an end down (rotating about the level "away" axis) and
 * twisting about the screen normal both turn gravity in the screen plane: a
 * full-speed 20° strafe looks like a 27° twist. So the gyroscope splits each
 * turn into its strafe part and its twist part, and gravity keeps both honest:
 * the twist can never be more than gravity shows, so it can't drift, and the
 * phone never needs a manual recalibration for it.
 *
 * STAYING CALIBRATED
 *
 * - Calibration takes a short, loose hold (or gives up waiting and uses the
 *   average pose), so it never gets stuck on "hold still".
 * - While the phone rests inside the deadzone, neutral slowly follows it, so a
 *   grip that creeps over minutes doesn't start walking on its own.
 * - Holding a completely different pose (set down flat, new grip) for a moment
 *   recalibrates by itself.
 *
 * LATENCY
 *
 * Tilt comes straight from the OS's fused gravity, with only a light anti-jitter
 * filter; flicks fire at the turn of the flick, not after the phone has come
 * all the way back.
 *
 * GUNNER PHONE
 *
 * Only aims: the gyroscope turns the camera. `lookDX`/`lookDY` carry the exact
 * degrees turned this sample, so the game can turn 1:1 with the phone; `lookX`
 * and `lookY` are the same as rates (1 = 130°/s) for older games.
 */

const settings = {
	// Calibration: a short, loose hold; never wait forever.
	calibrationMs: 320,
	calibrationMaxRate: 30, // deg/s
	calibrationGiveUpMs: 1600,

	// Walking: held tilt away from neutral, with hysteresis.
	enterDeg: 5,
	exitDeg: 3.5,
	fullSpeedDeg: 20,
	// Strafing needs a smaller wrist movement than forward/backward tilt.
	strafeEnterDeg: 3.5,
	strafeExitDeg: 3,
	strafeFullSpeedDeg: 12,
	strafeCurve: 0.7,
	curve: 0.85, // < 1 eases small tilts in faster
	jitterTau: 0.025, // s, light filter on the output

	// Gravity smoothing when the phone gives no linear acceleration.
	rawGravityTau: 0.06,

	// Neutral follows a resting phone slowly; a held, very different pose recalibrates.
	neutralTau: 2.5, // s
	neutralQuietRate: 30, // deg/s
	repositionDeg: 50, // runner; the gunner aims far up and down, so only a very different pose counts
	gunnerRepositionDeg: 80,
	repositionMs: 1200,

	// Flicks: a fast pitch burst that turns back.
	flickStartRate: 110, // deg/s
	flickPeakRate: 130,
	flickMinDeg: 9,
	flickReverseRate: 35, // the turn-back that marks a flick, not a one-way tilt
	flickMaxMs: 380,
	flickSettleRate: 45, // a burst that stops without turning back is a tilt: release it at once
	flickSettleMs: 24,
	flickDominance: 1.5,
	afterGestureMs: 220,

	// Sprint twist.
	twistTriggerDeg: 30,
	twistRearmDeg: 12,
	twistCooldownMs: 350,
	twistSlackDeg: 4, // twist may exceed what gravity shows by this much (noise)

	// Gunner.
	aimMaxRate: 130,
	aimDeadzone: 1.5, // deg/s: hand tremor
};

// Flip a sign here if a direction comes out reversed on a real phone.
const axes = {
	forwardSign: 1, // + = top edge away walks forward
	rightSign: 1, // + = right end down strafes right
	// + rates.y turns the phone left and + rates.x tips its back up (right-hand
	// rule); the game wants + lookX = turn right and + lookY = look up.
	gunnerYawSign: -1,
	gunnerPitchSign: 1,
};

/** The player's axes, in the phone's own frame, worked out from neutral. */
export type Frame = {
	grip: Grip;
	down: MotionVector; // gravity direction at neutral
	up: MotionVector; // screen's up direction, in the screen plane
	right: MotionVector; // player's left-right axis
	away: MotionVector; // level, pointing away from the player
};

type Move = { x: number; y: number };

type Flick = {
	startedAt: number;
	direction: number; // sign of the pitch rate that started it
	turned: number; // degrees in `direction`
	peak: number;
	other: number; // degrees turned about the other axes
	settledSince: number | null;
	moveBefore: Move;
};

const zAxis: MotionVector = { x: 0, y: 0, z: 1 };
const still: Move = { x: 0, y: 0 };

function buildFrame(down: MotionVector, grip?: Grip): Frame {
	// Screen's up = world up, projected onto the screen plane.
	const inPlane = { x: -down.x, y: -down.y, z: 0 };
	const flat = magnitude(inPlane) < 0.25;
	const up = flat ? { x: 0, y: 1, z: 0 } : normalize(inPlane);
	const right = cross(up, zAxis);
	const away = normalize(cross(scale(down, -1), right));
	const found: Grip = flat ? "flat" : Math.abs(up.x) > Math.abs(up.y) ? "landscape" : up.y > 0 ? "portrait" : "upside down";
	return { grip: grip ?? found, down, up, right, away };
}

/** Device rotation (degrees) about `axis` that turned gravity from `from` to `to`. */
function rotationAbout(from: MotionVector, to: MotionVector, axis: MotionVector) {
	// Gravity turns the opposite way to the phone, hence the minus.
	return -radToDeg(Math.asin(clamp(dot(cross(from, to), axis))));
}

/** How far gravity has turned in the screen plane since `from`, degrees (+ = about +Z). */
function screenAngle(from: MotionVector, to: MotionVector) {
	if (Math.hypot(from.x, from.y) < 0.25 || Math.hypot(to.x, to.y) < 0.25) return 0;
	// The phone turns the opposite way to gravity.
	return -radToDeg(Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y));
}

function blend(current: number, target: number, dt: number, tau: number) {
	return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function finite(v: MotionVector | null | undefined) {
	return !v || (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
}

function tiltToMovement(degrees: number, wasActive: boolean, strafe = false): { value: number; active: boolean } {
	const enter = strafe ? settings.strafeEnterDeg : settings.enterDeg;
	const exit = strafe ? settings.strafeExitDeg : settings.exitDeg;
	const full = strafe ? settings.strafeFullSpeedDeg : settings.fullSpeedDeg;
	const abs = Math.abs(degrees);
	if (abs < (wasActive ? exit : enter)) return { value: 0, active: false };
	const portion = clamp((abs - exit) / (full - exit), 0, 1);
	return { value: Math.sign(degrees) * Math.pow(portion, strafe ? settings.strafeCurve : settings.curve), active: true };
}

function aimRate(degreesPerSecond: number) {
	return Math.abs(degreesPerSecond) >= settings.aimDeadzone ? degreesPerSecond : 0;
}

export const emptyControls: GameControls = {
	ready: false,
	moveX: 0,
	moveY: 0,
	sprint: false,
	crouch: false,
	lookX: 0,
	lookY: 0,
	lookDX: 0,
	lookDY: 0,
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

export class MotionController {
	// Calibration
	private calibrationSince: number | null = null;
	private calibrationStarted: number | null = null;
	private gravitySum: MotionVector = { x: 0, y: 0, z: 0 };
	private looseSum: MotionVector = { x: 0, y: 0, z: 0 };
	private frame: Frame | null = null;
	private gravity: MotionVector | null = null;
	private lastSampleAt: number | null = null;
	private lastClockSource: "sensor" | "receipt" | null = null;
	private gyroBias: MotionVector = { x: 0, y: 0, z: 0 };
	private awaySince: number | null = null;

	// Runner
	private crouching = false;
	private sprinting = false;
	private move: Move = still;
	private walkX = false;
	private walkY = false;
	private flick: Flick | null = null;
	private quietUntil = 0;
	private lockedUntil = 0;
	private twist = 0; // degrees twisted about the screen normal since neutral
	private twistArmed = true;
	private twistLockedUntil = 0;

	private debug: MotionDebug = emptyDebug();

	/**
	 * @param role     which phone this is
	 * @param platform Platform.OS; expo-sensors orders the gyroscope axes differently per platform
	 */
	constructor(
		private readonly role: Role,
		private readonly platform: string = "ios"
	) {}

	/** Start over: forget neutral and stances, calibrate again. */
	reset() {
		this.calibrationSince = null;
		this.calibrationStarted = null;
		this.gravitySum = { x: 0, y: 0, z: 0 };
		this.looseSum = { x: 0, y: 0, z: 0 };
		this.frame = null;
		this.gravity = null;
		this.lastSampleAt = null;
		this.lastClockSource = null;
		this.gyroBias = { x: 0, y: 0, z: 0 };
		this.awaySince = null;
		this.crouching = false;
		this.sprinting = false;
		this.move = still;
		this.walkX = false;
		this.walkY = false;
		this.flick = null;
		this.quietUntil = 0;
		this.lockedUntil = 0;
		this.twist = 0;
		this.twistArmed = true;
		this.twistLockedUntil = 0;
		this.debug = emptyDebug();
	}

	getDebug(): MotionDebug {
		return { ...this.debug };
	}

	/** The calibrated player frame and current gravity, in the phone's frame. Null until calibrated. */
	getOrientation(): { frame: Frame; gravity: MotionVector } | null {
		if (!this.frame || !this.gravity) return null;
		const f = this.frame;
		return {
			frame: { ...f, down: { ...f.down }, up: { ...f.up }, right: { ...f.right }, away: { ...f.away } },
			gravity: { ...this.gravity },
		};
	}

	process(reading: MotionReading, now = globalThis.performance?.now() ?? Date.now()): GameControls {
		const total = reading.accelerationIncludingGravity;
		const rate = reading.rotationRate;
		if (!total || !finite(total) || magnitude(total) < 0.1 || !finite(reading.acceleration) ||
			(rate && ![rate.alpha, rate.beta, rate.gamma].every(Number.isFinite))) {
			return this.hold();
		}
		// Prefer the sensor's own clock: JS callbacks can arrive in bunches.
		const stamp = reading.timestamp ?? rate?.timestamp ?? total.timestamp ?? reading.rotation?.timestamp;
		const source = typeof stamp === "number" && Number.isFinite(stamp) && stamp >= 0 ? "sensor" : "receipt";
		const t = source === "sensor" ? stamp! * 1000 : now;
		let gap = this.lastSampleAt === null ? 0 : (t - this.lastSampleAt) / 1000;
		if ((this.lastClockSource !== null && source !== this.lastClockSource) || gap < 0 || gap > 0.35) {
			// Restarts, backgrounding and clock-source changes must not integrate a jump,
			// or leave every future sample rejected against the old clock.
			this.reset();
			gap = 0;
		} else if (this.lastSampleAt !== null && t === this.lastSampleAt) return this.hold();
		const dt = clamp(gap || 0.016, 0, 0.1);
		this.lastClockSource = source;
		this.lastSampleAt = t;

		const rawGyro = rate ? deviceRotationRate(rate, this.platform) : null;
		if (rawGyro && magnitude(rawGyro) < 3 && (!this.frame || magnitude(rawGyro) < 0.8)) {
			// Learn small zero-rate offsets at rest, without absorbing deliberate turns.
			const k = 1 - Math.exp(-dt / (this.frame ? 5 : 0.15));
			this.gyroBias = {
				x: this.gyroBias.x + k * (rawGyro.x - this.gyroBias.x),
				y: this.gyroBias.y + k * (rawGyro.y - this.gyroBias.y),
				z: this.gyroBias.z + k * (rawGyro.z - this.gyroBias.z),
			};
		}
		const gyro = rawGyro ? { x: rawGyro.x - this.gyroBias.x, y: rawGyro.y - this.gyroBias.y, z: rawGyro.z - this.gyroBias.z } : null;
		const gravity = this.updateGravity(reading, dt, gyro);
		const speed = gyro ? magnitude(gyro) : 0;

		if (!this.frame) {
			this.calibrate(gravity, speed, t);
			return { ...emptyControls, ready: this.frame !== null };
		}

		if (this.repositioned(gravity, this.frame, speed, t)) {
			return { ...emptyControls };
		}

		const frame = this.frame;
		// Gyro about the player's axes: x = pitch (about right), y = about the screen's up, z = screen normal.
		const rates = gyro ? { x: dot(gyro, frame.right), y: dot(gyro, frame.up), z: gyro.z } : null;
		this.debug.pitchRate = rates?.x ?? 0;
		this.debug.sidePressRate = rates?.y ?? 0;
		this.debug.twistRate = rates?.z ?? 0;

		return this.role === "movement"
			? this.processMovement(gravity, frame, gyro, rates, speed, t, dt)
			: this.processGunner(gyro, gravity, frame, dt);
	}

	/** Output while a sample is unusable: keep stances, stop moving. */
	private hold(): GameControls {
		return { ...emptyControls, ready: this.frame !== null, crouch: this.crouching, sprint: this.sprinting };
	}

	/** Unit gravity in the phone's frame (points at the ground). */
	private updateGravity(reading: MotionReading, dt: number, gyro: MotionVector | null): MotionVector {
		const total = reading.accelerationIncludingGravity;
		const linear = reading.acceleration;
		if (linear) {
			// The OS has already fused gravity with the gyroscope: use it as is (no lag).
			const fused = { x: total.x - linear.x, y: total.y - linear.y, z: total.z - linear.z };
			if (magnitude(fused) > 1) {
				this.gravity = normalize(fused);
				return this.gravity;
			}
		}
		// No linear acceleration (some browsers): smooth out hand motion instead.
		const sample = normalize(total);
		// Predict gravity with gyro for immediate tilt response; accelerometer corrects
		// long-term drift. Reduce correction during linear jolts, rather than steering
		// the character in response to shaking the phone.
		if (this.gravity && gyro) {
			const turn = cross(scale(gyro, Math.PI / 180), this.gravity);
			this.gravity = normalize({ x: this.gravity.x - turn.x * dt, y: this.gravity.y - turn.y * dt, z: this.gravity.z - turn.z * dt });
		}
		const confidence = Math.abs(magnitude(total) - 9.80665) < 1.5 ? 1 : 0.05;
		const k = (1 - Math.exp(-dt / settings.rawGravityTau)) * confidence;
		this.gravity = this.gravity
			? normalize({
				x: this.gravity.x + k * (sample.x - this.gravity.x),
				y: this.gravity.y + k * (sample.y - this.gravity.y),
				z: this.gravity.z + k * (sample.z - this.gravity.z),
			})
			: sample;
		return this.gravity;
	}

	/** A short, loose hold sets neutral; if the hands never settle, use the average pose. */
	private calibrate(gravity: MotionVector, speed: number, t: number) {
		this.calibrationStarted ??= t;
		this.looseSum = { x: this.looseSum.x + gravity.x, y: this.looseSum.y + gravity.y, z: this.looseSum.z + gravity.z };
		if (speed <= settings.calibrationMaxRate) {
			if (this.calibrationSince === null) {
				this.calibrationSince = t;
				this.gravitySum = { x: 0, y: 0, z: 0 };
			}
			this.gravitySum = { x: this.gravitySum.x + gravity.x, y: this.gravitySum.y + gravity.y, z: this.gravitySum.z + gravity.z };
			if (t - this.calibrationSince >= settings.calibrationMs) this.setNeutral(normalize(this.gravitySum));
		} else {
			this.calibrationSince = null;
		}
		if (!this.frame && t - this.calibrationStarted >= settings.calibrationGiveUpMs) {
			this.setNeutral(normalize(this.looseSum));
		}
	}

	private setNeutral(down: MotionVector) {
		if (magnitude(down) < 0.5) down = this.gravity ?? { x: 0, y: 0, z: -1 };
		this.frame = buildFrame(down);
		this.calibrationSince = null;
		this.calibrationStarted = null;
		this.looseSum = { x: 0, y: 0, z: 0 };
		this.twist = 0;
		this.twistArmed = true;
		this.debug.calibration = "ready";
		this.debug.grip = this.frame.grip;
	}

	/** Held far from neutral and still for a moment (new grip, set down): calibrate again. */
	private repositioned(gravity: MotionVector, frame: Frame, speed: number, t: number): boolean {
		const off = radToDeg(Math.acos(clamp(dot(frame.down, gravity))));
		const limit = this.role === "movement" ? settings.repositionDeg : settings.gunnerRepositionDeg;
		if (off < limit || speed > settings.calibrationMaxRate) {
			this.awaySince = null;
			return false;
		}
		this.awaySince ??= t;
		if (t - this.awaySince < settings.repositionMs) return false;
		// Keep stances; only neutral is new.
		this.frame = null;
		this.awaySince = null;
		this.flick = null;
		this.move = still;
		this.debug.calibration = "calibrating";
		this.calibrate(gravity, speed, t);
		return true;
	}

	// -------------------- MOVEMENT PHONE --------------------

	private processMovement(
		gravity: MotionVector,
		frame: Frame,
		gyro: MotionVector | null,
		rates: MotionVector | null,
		speed: number,
		t: number,
		dt: number
	): GameControls {
		// Split this sample's turn into twist (about the screen normal) and strafe (about the
		// level away axis); they're not perpendicular, so solve for both.
		if (gyro) {
			const c = dot(zAxis, frame.away);
			const det = 1 - c * c;
			if (det > 0.05) {
				const a = dot(gyro, frame.away);
				const n = gyro.z;
				const twistRate = (n - c * a) / det;
				this.twist += twistRate * dt;
			}
		}
		// Gravity shows twist + strafe in the screen plane; twist can't be more than that.
		const screen = screenAngle(frame.down, gravity);
		const bound = Math.abs(screen) + settings.twistSlackDeg;
		this.twist = clamp(this.twist, -bound, bound);

		const forwardDeg = -axes.forwardSign * rotationAbout(frame.down, gravity, frame.right);
		// Strafe = held tip about `away`, minus what the twist contributes to it.
		const tipDeg = rotationAbout(frame.down, gravity, frame.away);
		const rightDeg = axes.rightSign * (tipDeg - this.twist * dot(zAxis, frame.away));

		let action: Action = this.updateTwist(t);
		if (action) {
			// The twist itself no longer strafes, so walking carries on through it.
			this.flick = null;
			this.lockedUntil = t + settings.afterGestureMs;
		} else if (rates) {
			action = this.updateFlick(rates, t, dt);
		}

		const atNeutral = Math.abs(forwardDeg) < settings.enterDeg && Math.abs(rightDeg) < settings.strafeEnterDeg;
		const x = tiltToMovement(rightDeg, this.walkX, true);
		const y = tiltToMovement(forwardDeg, this.walkY);
		this.walkX = x.active;
		this.walkY = y.active;
		let target: Move = { x: x.value, y: y.value };
		const size = Math.hypot(target.x, target.y);
		if (size > 1) target = { x: target.x / size, y: target.y / size };
		if (this.flick) {
			// Mid-flick: never walk more than before it (a flick isn't a walk), but stopping
			// shows at once.
			const before = this.flick.moveBefore;
			const calmer = (live: number, was: number) => (Math.abs(live) < Math.abs(was) || Math.sign(live) !== Math.sign(was) ? (Math.sign(live) === Math.sign(was) ? live : 0) : was);
			target = { x: calmer(target.x, before.x), y: calmer(target.y, before.y) };
		} else if (t < this.quietUntil && !atNeutral) {
			// Just after a flick, the swing back to neutral never walks.
			target = still;
		} else {
			this.quietUntil = 0;
		}
		this.move = {
			x: Math.abs(target.x) < 0.01 && Math.abs(this.move.x) < 0.02 ? target.x : blend(this.move.x, target.x, dt, settings.jitterTau),
			y: Math.abs(target.y) < 0.01 && Math.abs(this.move.y) < 0.02 ? target.y : blend(this.move.y, target.y, dt, settings.jitterTau),
		};

		// Resting inside the deadzone: let neutral follow the hands, so slow grip creep never walks.
		if (atNeutral && !this.flick && speed < settings.neutralQuietRate && Math.abs(this.twist) < settings.twistRearmDeg) {
			const k = 1 - Math.exp(-dt / settings.neutralTau);
			const down = normalize({
				x: frame.down.x + k * (gravity.x - frame.down.x),
				y: frame.down.y + k * (gravity.y - frame.down.y),
				z: frame.down.z + k * (gravity.z - frame.down.z),
			});
			this.frame = buildFrame(down, frame.grip);
			this.twist *= 1 - k;
		}

		this.debug.pitchDeg = forwardDeg;
		this.debug.sidePressDeg = rightDeg;
		this.debug.burst = this.flick ? "pitch" : Math.abs(this.twist) > settings.twistRearmDeg ? "twist" : "none";
		this.debug.gesture = t >= this.lockedUntil ? "armed" : "locked";
		this.debug.sprintPhase = this.sprinting ? "on" : "off";

		return {
			...emptyControls,
			ready: true,
			action,
			moveX: this.move.x,
			moveY: this.move.y,
			crouch: this.crouching,
			sprint: this.sprinting,
		};
	}

	/** A quick pitch flick fires when it turns back, so a one-way fast tilt never crouches. */
	private updateFlick(rates: MotionVector, t: number, dt: number): Action {
		const pitch = -axes.forwardSign * rates.x; // + = top edge going away
		const other = Math.max(Math.abs(rates.y), Math.abs(rates.z));
		if (!this.flick) {
			if (t < this.lockedUntil || Math.abs(pitch) < settings.flickStartRate || Math.abs(pitch) < other * settings.flickDominance) return null;
			this.flick = { startedAt: t, direction: Math.sign(pitch), turned: 0, peak: 0, other: 0, settledSince: null, moveBefore: this.move };
		}
		const f = this.flick;
		const along = f.direction * pitch;
		f.turned += along * dt;
		f.peak = Math.max(f.peak, along);
		f.other += other * dt;

		const turnedBack = along <= -settings.flickReverseRate;
		if (turnedBack && f.turned >= settings.flickMinDeg && f.peak >= settings.flickPeakRate && f.turned >= f.other * settings.flickDominance) {
			this.flick = null;
			this.lockedUntil = t + settings.afterGestureMs + 120;
			this.quietUntil = t + settings.afterGestureMs;
			return f.direction > 0 ? this.toggleCrouch() : this.jump();
		}
		// A one-way tilt (stopped without turning back), a slow return, or mostly another axis:
		// not a flick. Let go right away so walking isn't held back.
		f.settledSince = Math.abs(pitch) < settings.flickSettleRate ? (f.settledSince ?? t) : null;
		const settled = f.settledSince !== null && t - f.settledSince >= settings.flickSettleMs;
		if (turnedBack || settled || t - f.startedAt > settings.flickMaxMs) this.flick = null;
		return null;
	}

	/** Twist past the trigger toggles sprint; it re-arms once the twist is back near center. */
	private updateTwist(t: number): Action {
		const angle = Math.abs(this.twist);
		if (angle <= settings.twistRearmDeg && t >= this.twistLockedUntil) this.twistArmed = true;
		if (!this.twistArmed || t < this.twistLockedUntil || angle < settings.twistTriggerDeg) return null;
		this.twistArmed = false;
		this.twistLockedUntil = t + settings.twistCooldownMs;
		this.sprinting = !this.sprinting;
		if (this.sprinting) this.crouching = false;
		return "sprint";
	}

	private toggleCrouch(): Action {
		this.crouching = !this.crouching;
		if (this.crouching) this.sprinting = false;
		return "crouch";
	}

	private jump(): Action {
		if (this.crouching) {
			this.crouching = false;
			return "stand";
		}
		return "jump";
	}

	// -------------------- GUNNER PHONE --------------------

	/**
	 * The gunner's phone only aims; firing, scope, reload and weapons are buttons.
	 * Yaw is the turn about true vertical (current gravity), so turning your body turns the
	 * camera fully however far the phone is tilted back; pitch is about the level left-right axis.
	 */
	private processGunner(gyro: MotionVector | null, gravity: MotionVector, frame: Frame, dt: number): GameControls {
		const output: GameControls = { ...emptyControls, ready: true };
		if (gyro) {
			// Turning right / tipping the back of the phone up = looking right / up.
			const level = normalize(cross(frame.up, scale(gravity, -1)));
			const right = magnitude(level) > 0.5 ? level : frame.right;
			const yaw = aimRate(axes.gunnerYawSign * dot(gyro, scale(gravity, -1)));
			const pitch = aimRate(axes.gunnerPitchSign * dot(gyro, right));
			output.lookX = clamp(yaw / settings.aimMaxRate);
			output.lookY = clamp(pitch / settings.aimMaxRate);
			output.lookDX = yaw * dt;
			output.lookDY = pitch * dt;
		}
		return output;
	}
}
