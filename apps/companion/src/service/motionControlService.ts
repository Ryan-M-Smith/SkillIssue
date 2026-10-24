export type Role = "movement" | "gunner";

interface Vector3{
  x: number;
  y: number;
  z: number;
};

interface Angles{
  alpha: number;
  beta: number;
  gamma: number;
};

interface MotionReading{
  rotation: Angles;
  rotationRate: Angles | null;
  acceleration: Vector3 | null;
  accelerationIncludingGravity: Vector3;
};

export type Action = "jump" | "crouch" | "shoot" | null;

interface GameControls{
  ready: boolean;
  moveX: number;
  moveY: number;
  sprint: boolean;
  crouch: boolean;
  lookX: number;
  lookY: number;
  action: Action;
};

// Adjustable settings
const SETTINGS = {
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
const AXES = {
  moveForwardSign: 1,
  moveRightSign: 1,
  gunnerYawSign: 1,
  gunnerPitchSign: -1,
  forwardJabZSign: -1,
};

const clamp = (
  n: number,
  min = -1,
  max = 1
) => Math.max(min, Math.min(max, n));

const magnitude = (v: Vector3) =>
  Math.hypot(v.x, v.y, v.z);

const angularMagnitude = (v: Angles | null) =>
  v ? Math.hypot(v.alpha, v.beta, v.gamma) : 0;

const radiansToDegrees = (rad: number) =>
  (rad * 180) / Math.PI;

const angleDiff = (current: number, initial: number) =>
  Math.atan2(
    Math.sin(current - initial),
    Math.cos(current - initial)
  );

// Convert tilt angle into WASD-style movement
function tiltToMovement(degrees: number) {
  if (Math.abs(degrees) < SETTINGS.deadzoneDeg) {
    return 0;
  }

  const intensity =
    (Math.abs(degrees) - SETTINGS.deadzoneDeg) /
    (SETTINGS.maxWalkTiltDeg - SETTINGS.deadzoneDeg);

  return Math.sign(degrees) * clamp(intensity);
}

// Convert gyroscope angular velocity into camera input
function gyroToMovement(degreesPerSecond: number) {
  if (
    Math.abs(degreesPerSecond) < SETTINGS.aimDeadzone
  ) {
    return 0;
  }

  return clamp(
    degreesPerSecond / SETTINGS.aimMaxRate
  );
}

export const EMPTY_CONTROLS: GameControls = {
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
  private neutral: Angles | null = null;

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
        linearMagnitude < SETTINGS.calibrationMaxLinear &&
        angularSpeed < SETTINGS.calibrationMaxRotation
      ) {
        if (this.calibrationSince === null) {
          this.calibrationSince = now;
        }

        if (
          now - this.calibrationSince >=
          SETTINGS.calibrationMs
        ) {
          this.neutral = { ...reading.rotation };
          this.armed = true;
        }
      } else {
        this.calibrationSince = null;
      }

      return {
        ...EMPTY_CONTROLS,
        ready: this.neutral !== null,
      };
    }

    let action: Action = null;

    // STEP 2: REARM GESTURES
    // Prevent returning the phone from triggering another action.
    if (!this.armed) {
      const settled =
        now >= this.lockedUntil &&
        linearMagnitude < SETTINGS.rearmAcceleration &&
        angularSpeed < SETTINGS.rearmRotation;

      if (settled) {
        if (this.stillSince === null) {
          this.stillSince = now;
        }

        if (
          now - this.stillSince >=
          SETTINGS.rearmStillMs
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
      angularSpeed < SETTINGS.gestureMaxRotation
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
            SETTINGS.flickThreshold &&
          Math.abs(verticalImpulse) >
            0.75 * linearMagnitude
        ) {
          action =
            verticalImpulse > 0 ? "jump" : "crouch";

          if (action === "crouch") {
            this.crouchUntil =
              now + SETTINGS.crouchDurationMs;
          }
        }
      } else {
        // GUNNER: forward jab to shoot
        const forwardImpulse =
          AXES.forwardJabZSign * linear.z;

        if (
          forwardImpulse >= SETTINGS.jabThreshold &&
          forwardImpulse > 0.8 * linearMagnitude
        ) {
          action = "shoot";

          // Temporarily suppress camera jitter
          this.aimFrozenUntil =
            now + SETTINGS.aimFreezeAfterShotMs;
        }
      }

      // Lock gesture recognition after an action
      if (action) {
        this.armed = false;
        this.lockedUntil =
          now + SETTINGS.gestureCooldownMs;
        this.stillSince = null;
      }
    }

    const output: GameControls = {
      ...EMPTY_CONTROLS,
      ready: true,
      action,
    };

    // STEP 4: MOVEMENT CONTROLS
    if (this.role === "movement") {
      const forwardDeg =
        AXES.moveForwardSign *
        radiansToDegrees(
          angleDiff(
            reading.rotation.beta,
            this.neutral.beta
          )
        );

      const rightDeg =
        AXES.moveRightSign *
        radiansToDegrees(
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
      if (forwardDeg >= SETTINGS.sprintOnDeg) {
        if (this.sprintSince === null) {
          this.sprintSince = now;
        }

        if (
          now - this.sprintSince >=
          SETTINGS.sprintHoldMs
        ) {
          this.sprinting = true;
        }
      } else {
        this.sprintSince = null;

        if (forwardDeg < SETTINGS.sprintOffDeg) {
          this.sprinting = false;
        }
      }

      output.sprint =
        this.sprinting && !output.crouch;
    }

    // STEP 5: GUNNER CAMERA CONTROLS
    else if (
      gyro &&
      now >= this.aimFrozenUntil
    ) {
      output.lookX = gyroToMovement(
        AXES.gunnerYawSign * gyro.gamma
      );

      output.lookY = gyroToMovement(
        AXES.gunnerPitchSign * gyro.beta
      );
    }

    return output;
  }
}
