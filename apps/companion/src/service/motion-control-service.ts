import type {
	Action,
	GameControls,
	MotionAngles,
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

// Adjustable settings
const settings = {
	calibrationMs: 900,
	calibrationMaxLinear: 0.9,
	calibrationMaxRotation: 13,

	deadzoneDeg: 8,
	maxWalkTiltDeg: 27,

	sprintOnDeg: 32,
	sprintOffDeg: 23,
	sprintHoldMs: 200,

	flickThreshold: 5.0,
	jabThreshold: 5.5,
	gestureMaxRotation: 110,

	gestureCooldownMs: 650,
	rearmStillMs: 400,
	rearmAcceleration: 1.2,
	rearmRotation: 25,

	crouchDurationMs: 1500,
	aimFreezeAfterShotMs: 110,

	aimMaxRate: 130,
	aimDeadzone: 3,
};

// Change signs if motion directions are reversed
const axes = {
	moveForwardSign: 1,
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
	return Math.abs(degreesPerSecond) >= settings.aimDeadzone?
		clamp(degreesPerSecond / settings.aimMaxRate) : 0
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

export class MotionController {
	private calibrationSince: number | null = null;
	private neutral: MotionAngles | null = null;

	private armed = false;
	private lockedUntil = 0;
	private stillSince: number | null = null;

	private sprintSince: number | null = null;
	private sprinting = false;

	private crouchUntil = 0;
	private aimFrozenUntil = 0;

	constructor(private readonly role: Role) {}

	// Recalibrate when necessary
	reset() {
		this.calibrationSince = null;
		this.neutral = null;
		this.armed = false;
		this.lockedUntil = 0;
		this.stillSince = null;
		this.sprintSince = null;
		this.sprinting = false;
		this.crouchUntil = 0;
		this.aimFrozenUntil = 0;
	}

	process(
		reading: MotionReading,
		now = Date.now()
	): GameControls {
		const linear = reading.acceleration;
		const gyro = reading.rotationRate;

		const linearMagnitude = linear
			? magnitude(linear)
			: Infinity;

		const angularSpeed = gyro
			? angularMagnitude(gyro)
			: Infinity;

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

				if (
					now - this.calibrationSince >=
					settings.calibrationMs
				) {
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

		let action: Action = null;

		// STEP 2: REARM GESTURES
		// Prevent returning the phone from triggering another action.
		if (!this.armed) {
			const settled =
				now >= this.lockedUntil &&
				linearMagnitude < settings.rearmAcceleration &&
				angularSpeed < settings.rearmRotation;

			if (settled) {
				if (this.stillSince === null) {
					this.stillSince = now;
				}

				if (
					now - this.stillSince >=
					settings.rearmStillMs
				) {
					this.armed = true;
				}
			} else {
				this.stillSince = null;
			}
		}

		// STEP 3: DETECT SINGLE-ACTION GESTURES
		if (
			this.armed &&
			linear &&
			angularSpeed < settings.gestureMaxRotation
		) {
			if (this.role === "movement") {
				// Estimate gravity vector
				const g = {
					x:
						reading.accelerationIncludingGravity.x -
						linear.x,
					y:
						reading.accelerationIncludingGravity.y -
						linear.y,
					z:
						reading.accelerationIncludingGravity.z -
						linear.z,
				};

				const length = magnitude(g);

				// Project acceleration onto the vertical axis
				const verticalImpulse =
					length > 3
						? (
								linear.x * g.x +
								linear.y * g.y +
								linear.z * g.z
							) / length
						: 0;

				// Reject mostly sideways shaking
				if (
					Math.abs(verticalImpulse) >=
						settings.flickThreshold &&
					Math.abs(verticalImpulse) >
						0.75 * linearMagnitude
				) {
					action =
						verticalImpulse > 0 ? "jump" : "crouch";

					if (action === "crouch") {
						this.crouchUntil =
							now + settings.crouchDurationMs;
					}
				}
			} else {
				// GUNNER: forward jab to shoot
				const forwardImpulse =
					axes.forwardJabZSign * linear.z;

				if (
					forwardImpulse >= settings.jabThreshold &&
					forwardImpulse > 0.8 * linearMagnitude
				) {
					action = "shoot";

					// Temporarily suppress camera jitter
					this.aimFrozenUntil =
						now + settings.aimFreezeAfterShotMs;
				}
			}

			// Lock gesture recognition after an action
			if (action) {
				this.armed = false;
				this.lockedUntil =
					now + settings.gestureCooldownMs;
				this.stillSince = null;
			}
		}

		const output: GameControls = {
			...emptyControls,
			ready: true,
			action,
		};

		// STEP 4: MOVEMENT CONTROLS
		if (this.role === "movement") {
			const forwardDeg =
				axes.moveForwardSign *
				radToDeg(
					angleDiff(
						reading.rotation.beta,
						this.neutral.beta
					)
				);

			const rightDeg =
				axes.moveRightSign *
				radToDeg(
					angleDiff(
						reading.rotation.gamma,
						this.neutral.gamma
					)
				);

			output.moveX = tiltToMovement(rightDeg);
			output.moveY = tiltToMovement(forwardDeg);

			// Timed crouch
			output.crouch = now < this.crouchUntil;

			// Sprint only after sustained forward tilt
			if (forwardDeg >= settings.sprintOnDeg) {
				if (this.sprintSince === null) {
					this.sprintSince = now;
				}

				if (
					now - this.sprintSince >=
					settings.sprintHoldMs
				) {
					this.sprinting = true;
				}
			} else {
				this.sprintSince = null;

				if (forwardDeg < settings.sprintOffDeg) {
					this.sprinting = false;
				}
			}

			output.sprint =
				this.sprinting && !output.crouch;
		}

		// STEP 5: GUNNER CAMERA CONTROLS
		else if (gyro && now >= this.aimFrozenUntil
		) {
			output.lookX = gyroToMovement(
				axes.gunnerYawSign * gyro.gamma
			);

			output.lookY = gyroToMovement(
				axes.gunnerPitchSign * gyro.beta
			);
		}

		return output;
	}
}
