
export type Role = "movement" | "gunner";
export type Action = "jump" | "crouch" | "shoot" | null;

type Vector3 = {
  x: number;
  y: number;
  z: number;
};

type Rates = {
  alpha: number;
  beta: number;
  gamma: number;
};

type MotionReading = {
  acceleration: Vector3 | null;
  accelerationIncludingGravity: Vector3;
  rotationRate: Rates | null;
};

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

// Assumes landscape with screen facing upward
// or slightly toward you.
//
// Reverse signs if physical directions are wrong.
const AXIS = {
  forwardTilt: 1,
  strafeTilt: 1,
  forwardPush: 1,
  upLift: 1,
  yaw: 1,
  pitch: -1,
  shootPush: 1,
};

const CFG = {
  calibrationMs: 800,
  stillLinear: 0.85,
  stillRotation: 12,

  movementDeadzoneDeg: 5,
  maxTiltDeg: 27,
  tiltSmoothing: 0.25,

  sprintOnDeg: 32,
  sprintOffDeg: 23,
  sprintHoldMs: 200,

  pushThreshold: 2.3,
  pushBurstMs: 750,
  pushCooldownMs: 1000,

  jumpMinAcceleration: 1.25,
  jumpImpulse: 0.16,
  jumpMinMs: 65,

  crouchAcceleration: 4.2,
  crouchMs: 1200,

  gestureCooldownMs: 900,
  recoveryAcceleration: 1.25,
  rearmStillMs: 220,

  jabThreshold: 5,
  aimDeadzone: 3,
  aimMaxRate: 130,
};

const clamp = (
  value: number,
  min = -1,
  max = 1
) => Math.max(min, Math.min(max, value));

const length = (v: Vector3) =>
  Math.hypot(v.x, v.y, v.z);

const dot = (a: Vector3, b: Vector3) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

const degrees = (radians: number) =>
  radians * (180 / Math.PI);

function tiltAxis(angle: number): number {
  const amount = Math.abs(angle);

  if (amount <= CFG.movementDeadzoneDeg) {
    return 0;
  }

  return (
    Math.sign(angle) *
    clamp(
      (amount - CFG.movementDeadzoneDeg) /
        (CFG.maxTiltDeg - CFG.movementDeadzoneDeg),
      0,
      1
    )
  );
}

function aimAxis(rate: number): number {
  if (Math.abs(rate) < CFG.aimDeadzone) {
    return 0;
  }

  return clamp(rate / CFG.aimMaxRate);
}

// Project a device axis onto the horizontal plane.
function horizontalAxis(
  up: Vector3,
  axis: "x" | "y"
): Vector3 | null {
  const unit =
    axis === "x"
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 1, z: 0 };

  const verticalComponent = dot(unit, up);

  const projected = {
    x: unit.x - up.x * verticalComponent,
    y: unit.y - up.y * verticalComponent,
    z: unit.z - up.z * verticalComponent,
  };

  const norm = length(projected);

  if (norm < 0.35) {
    return null;
  }

  return {
    x: projected.x / norm,
    y: projected.y / norm,
    z: projected.z / norm,
  };
}

export class MotionController {
  private neutral: {
    forward: number;
    side: number;
  } | null = null;

  private calibrationSince: number | null = null;
  private lastSample: number | null = null;

  private smoothForward = 0;
  private smoothSide = 0;
  private smoothVertical = 0;
  private smoothPush = 0;

  private upSince: number | null = null;
  private upImpulse = 0;

  private gestureArmed = true;
  private gestureLockedUntil = 0;

  private expectedRecovery = 0;
  private recoverySeen = false;
  private rearmSince: number | null = null;

  private actionAt = 0;
  private suppressJumpUntil = 0;

  private crouchUntil = 0;
  private aimFrozenUntil = 0;

  private pushUntil = 0;
  private pushLockedUntil = 0;
  private pushDirection = 0;

  private sprintSince: number | null = null;
  private sprinting = false;

  constructor(private readonly role: Role) {}

  // Reset controller to recalibrate neutral position.
  reset() {
    this.neutral = null;
    this.calibrationSince = null;
    this.lastSample = null;

    this.smoothForward = 0;
    this.smoothSide = 0;
    this.smoothVertical = 0;
    this.smoothPush = 0;

    this.upSince = null;
    this.upImpulse = 0;

    this.gestureArmed = true;
    this.gestureLockedUntil = 0;

    this.expectedRecovery = 0;
    this.recoverySeen = false;
    this.rearmSince = null;

    this.actionAt = 0;
    this.suppressJumpUntil = 0;

    this.crouchUntil = 0;
    this.aimFrozenUntil = 0;

    this.pushUntil = 0;
    this.pushLockedUntil = 0;
    this.pushDirection = 0;

    this.sprintSince = null;
    this.sprinting = false;
  }

  private fireGesture(
    action: Exclude<Action, null>,
    now: number
  ) {
    this.gestureArmed = false;

    this.gestureLockedUntil =
      now + CFG.gestureCooldownMs;

    this.actionAt = now;
    this.recoverySeen = false;

    this.expectedRecovery =
      action === "jump"
        ? -1
        : action === "crouch"
        ? 1
        : 0;

    this.rearmSince = null;
    this.upSince = null;
    this.upImpulse = 0;

    if (action === "crouch") {
      this.crouchUntil = now + CFG.crouchMs;
    }

    if (action === "shoot") {
      this.aimFrozenUntil = now + 110;
    }
  }

  process(
    reading: MotionReading,
    now = Date.now()
  ): GameControls {
    // Time between sensor samples.
    const dt =
      this.lastSample === null
        ? 0.02
        : clamp(
            (now - this.lastSample) / 1000,
            0.005,
            0.05
          );

    this.lastSample = now;

    const a = reading.acceleration;
    const r = reading.rotationRate;
    const total =
      reading.accelerationIncludingGravity;

    // Estimate gravity.
    const g = {
      x: total.x - (a?.x ?? 0),
      y: total.y - (a?.y ?? 0),
      z: total.z - (a?.z ?? 0),
    };

    const gMagnitude = length(g);

    if (
      !Number.isFinite(gMagnitude) ||
      gMagnitude < 7 ||
      gMagnitude > 12
    ) {
      return {
        ...EMPTY_CONTROLS,
        ready: this.neutral !== null,
      };
    }

    const up = {
      x: g.x / gMagnitude,
      y: g.y / gMagnitude,
      z: g.z / gMagnitude,
    };

    // Landscape tilt measurement.
    const forwardAngle = degrees(
      Math.asin(clamp(up.x))
    );

    const sideAngle = degrees(
      Math.asin(clamp(up.y))
    );

    // STEP 1: AUTOMATIC CALIBRATION
    if (!this.neutral) {
      const linearStable =
        a === null ||
        length(a) < CFG.stillLinear;

      const angularStable =
        r === null ||
        Math.hypot(
          r.alpha,
          r.beta,
          r.gamma
        ) < CFG.stillRotation;

      if (linearStable && angularStable) {
        if (this.calibrationSince === null) {
          this.calibrationSince = now;
        }

        if (
          now - this.calibrationSince >=
          CFG.calibrationMs
        ) {
          this.neutral = {
            forward: forwardAngle,
            side: sideAngle,
          };
        }
      } else {
        this.calibrationSince = null;
      }

      return {
        ...EMPTY_CONTROLS,
        ready: this.neutral !== null,
      };
    }

    // STEP 2: MOVEMENT RELATIVE TO NEUTRAL
    const targetForward =
      AXIS.forwardTilt *
      (forwardAngle - this.neutral.forward);

    const targetSide =
      AXIS.strafeTilt *
      (sideAngle - this.neutral.side);

    // Smooth tilting to reduce jitter.
    this.smoothForward +=
      CFG.tiltSmoothing *
      (targetForward - this.smoothForward);

    this.smoothSide +=
      CFG.tiltSmoothing *
      (targetSide - this.smoothSide);

    // STEP 3: SEPARATE VERTICAL AND HORIZONTAL
    const forwardAxis = horizontalAxis(
      up,
      "x"
    );

    const sideAxis = horizontalAxis(
      up,
      "y"
    );

    const vertical = a
      ? dot(a, up) * AXIS.upLift
      : 0;

    const push =
      a && forwardAxis
        ? dot(a, forwardAxis) *
          AXIS.forwardPush
        : 0;

    const sideways =
      a && sideAxis
        ? dot(a, sideAxis)
        : 0;

    const smoothing = 0.45;

    this.smoothVertical +=
      smoothing *
      (vertical - this.smoothVertical);

    this.smoothPush +=
      smoothing *
      (push - this.smoothPush);

    let action: Action = null;

    // STEP 4: GESTURE RECOVERY
    if (!this.gestureArmed) {
      // Ignore opposite acceleration caused
      // by returning to the resting position.
      if (
        now - this.actionAt > 220 &&
        this.expectedRecovery *
          this.smoothVertical >
          CFG.recoveryAcceleration
      ) {
        this.recoverySeen = true;
      }

      const resting =
        Math.abs(this.smoothVertical) < 0.85 &&
        Math.abs(this.smoothPush) < 1.0;

      const recovered =
        this.expectedRecovery === 0 ||
        this.recoverySeen ||
        now - this.actionAt >= 1800;

      if (
        recovered &&
        now >= this.gestureLockedUntil &&
        resting
      ) {
        if (this.rearmSince === null) {
          this.rearmSince = now;
        }

        if (
          now - this.rearmSince >=
          CFG.rearmStillMs
        ) {
          this.gestureArmed = true;
          this.rearmSince = null;
        }
      } else {
        this.rearmSince = null;
      }
    }

    // STEP 5: JUMP AND CROUCH
    if (
      this.role === "movement" &&
      a &&
      this.gestureArmed
    ) {
      const verticalDominant =
        Math.abs(vertical) >
          Math.abs(push) * 1.15 &&
        Math.abs(vertical) >
          Math.abs(sideways) * 1.15;

      // Quick downward press -> crouch.
      if (
        verticalDominant &&
        this.smoothVertical <=
          -CFG.crouchAcceleration
      ) {
        action = "crouch";
      }

      // Smooth sustained upward lift -> jump.
      else if (
        verticalDominant &&
        this.smoothVertical >=
          CFG.jumpMinAcceleration &&
        now >= this.suppressJumpUntil
      ) {
        if (this.upSince === null) {
          this.upSince = now;
        }

        this.upImpulse +=
          this.smoothVertical * dt;

        if (
          now - this.upSince >=
            CFG.jumpMinMs &&
          this.upImpulse >=
            CFG.jumpImpulse
        ) {
          action = "jump";
        }
      } else {
        this.upSince = null;
        this.upImpulse = 0;
      }

      if (action) {
        this.fireGesture(action, now);
      }
    }

    const result: GameControls = {
      ...EMPTY_CONTROLS,
      ready: true,
      action,
    };

    // STEP 6: MOVEMENT PLAYER
    if (this.role === "movement") {
      const tiltForward = tiltAxis(
        this.smoothForward
      );

      result.moveX = tiltAxis(
        this.smoothSide
      );

      const horizontalDominant =
        Math.abs(this.smoothPush) >
        1.35 *
          Math.max(
            Math.abs(vertical),
            Math.abs(sideways)
          );

      // Push or pull -> short movement burst.
      if (
        a &&
        now >= this.pushLockedUntil &&
        Math.abs(this.smoothPush) >=
          CFG.pushThreshold &&
        horizontalDominant
      ) {
        this.pushDirection = Math.sign(
          this.smoothPush
        );

        this.pushUntil =
          now + CFG.pushBurstMs;

        this.pushLockedUntil =
          now + CFG.pushCooldownMs;

        this.suppressJumpUntil =
          now + 450;
      }

      const burstStrength =
        clamp(
          (this.pushUntil - now) / 200,
          0,
          1
        ) * 0.85;

      const burst =
        now < this.pushUntil
          ? this.pushDirection *
            burstStrength
          : 0;

      // Held tilt takes priority over push burst.
      result.moveY =
        Math.abs(tiltForward) > 0.15
          ? tiltForward
          : burst;

      result.crouch =
        now < this.crouchUntil;

      // Sprint detection.
      if (
        this.smoothForward >=
        CFG.sprintOnDeg
      ) {
        if (this.sprintSince === null) {
          this.sprintSince = now;
        }

        if (
          now - this.sprintSince >=
          CFG.sprintHoldMs
        ) {
          this.sprinting = true;
        }
      } else {
        this.sprintSince = null;

        if (
          this.smoothForward <
          CFG.sprintOffDeg
        ) {
          this.sprinting = false;
        }
      }

      result.sprint =
        this.sprinting &&
        !result.crouch;
    }

    // STEP 7: GUNNER PLAYER
    else {
      if (r) {
        result.lookX =
          now < this.aimFrozenUntil
            ? 0
            : aimAxis(
                AXIS.yaw * r.alpha
              );

        result.lookY =
          now < this.aimFrozenUntil
            ? 0
            : aimAxis(
                AXIS.pitch * r.gamma
              );
      }

      // Forward jab -> shoot.
      const jab =
        push * AXIS.shootPush;

      if (
        a &&
        this.gestureArmed &&
        jab > CFG.jabThreshold &&
        Math.abs(jab) >
          Math.abs(vertical) * 1.4
      ) {
        result.action = "shoot";
        this.fireGesture("shoot", now);
      }
    }

    return result;
  }
}
