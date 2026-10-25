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

export type {
  GameControls,
  MotionDebug,
  Role,
} from "@/types/motion";

/**
 * MOTION CONTROLLER
 *
 * MOVEMENT PHONE:
 *
 * 1. Slow forward tilt + hold = walk forward
 * 2. Slow backward tilt + hold = walk backward
 * 3. Side tilt + hold = strafe
 * 4. Fast forward flick + return = crouch toggle
 * 5. Fast backward flick + return = jump
 * 6. Twist ~32 degrees = sprint toggle
 *
 * Jump works while walking or sprinting.
 *
 * A fast one-way tilt should NOT trigger crouch.
 * Flicks require a clear reversal.
 *
 * Existing movement is retained during gestures.
 */

const settings = {
  calibrationMs: 480,
  calibrationMaxRate: 15,
  calibrationMaxLinear: 1.6,

  gravityTauWithLinear: 0.045,
  gravityTauWithoutLinear: 0.12,

  // Walking sensitivity
  walkEnterDeadzone: 5.4,
  walkExitDeadzone: 3.7,
  fullSpeedDeg: 20,

  // Movement smoothing
  movementRiseTau: 0.075,
  movementFallTau: 0.09,

  // Flick detection
  flickStartRate: 115,
  flickPeakRate: 145,
  flickMinTravel: 12.5,
  flickMinReturn: 6.0,
  flickReturnFraction: 0.36,
  flickReturnNearStart: 10.5,
  flickAxisDominance: 1.6,
  flickMaxMs: 430,
  flickQuietMs: 80,
  flickQuietRate: 36,

  gestureCooldownMs: 390,
  postFlickHoldMs: 140,

  // Sprint twist detection
  twistIgnoreRate: 9,
  twistDominance: 1.3,
  twistTriggerDeg: 31,
  twistPeakRate: 28,
  twistRearmDeg: 12,
  twistCooldownMs: 350,

  // Gunner controls
  jabThreshold: 3.4,
  liftThreshold: 4.2,
  gestureMaxRotation: 110,
  gunnerCooldownMs: 230,
  rearmStillMs: 90,
  rearmAcceleration: 1.8,
  rearmRotation: 40,
  aimFreezeAfterShotMs: 70,
  aimMaxRate: 130,
  aimDeadzone: 1.5,
};

const axes = {
  forwardSign: 1,
  rightSign: 1,
  gunnerYawSign: 1,
  gunnerPitchSign: -1,
  forwardJabZSign: -1,
};

export type Frame = {
  grip: Grip;
  down: MotionVector;
  up: MotionVector;
  right: MotionVector;
  away: MotionVector;
};

type Move = {
  x: number;
  y: number;
};

type PlayerRates = MotionVector;

type Flick = {
  startedAt: number;
  lastActiveAt: number;
  startPitch: number;
  direction: number;
  progress: number;
  furthest: number;
  peakPitchRate: number;
  peakOtherRate: number;
  otherTravel: number;
  moveAtStart: Move;
};

const zero: Move = { x: 0, y: 0 };

const zAxis: MotionVector = {
  x: 0,
  y: 0,
  z: 1,
};

function limit(
  value: number,
  lo: number,
  hi: number
): number {
  return Math.max(lo, Math.min(hi, value));
}

function blend(
  current: number,
  target: number,
  dt: number,
  tau: number
): number {
  return (
    current +
    (target - current) * (1 - Math.exp(-dt / tau))
  );
}

function validVector(v: MotionVector): boolean {
  return (
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}

function buildFrame(down: MotionVector): Frame {
  const inPlane = {
    x: -down.x,
    y: -down.y,
    z: 0,
  };

  const flat = magnitude(inPlane) < 0.25;

  const up: MotionVector = flat
    ? { x: 0, y: 1, z: 0 }
    : normalize(inPlane);

  const right = cross(up, zAxis);

  const away = normalize(
    cross(scale(down, -1), right)
  );

  const grip: Grip = flat
    ? "flat"
    : Math.abs(up.x) > Math.abs(up.y)
      ? "landscape"
      : up.y > 0
        ? "portrait"
        : "upside down";

  return {
    grip,
    down,
    up,
    right,
    away,
  };
}

function rotationAbout(
  from: MotionVector,
  to: MotionVector,
  axis: MotionVector
): number {
  return -radToDeg(
    Math.asin(
      clamp(dot(cross(from, to), axis))
    )
  );
}

function gyroToMovement(rate: number): number {
  return Math.abs(rate) >= settings.aimDeadzone
    ? limit(rate / settings.aimMaxRate, -1, 1)
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

export class MotionController {
  private calibrationSince: number | null = null;

  private gravitySum: MotionVector = {
    x: 0,
    y: 0,
    z: 0,
  };

  private calibrationCount = 0;

  private frame: Frame | null = null;
  private gravity: MotionVector | null = null;
  private lastSampleAt: number | null = null;

  // Movement state
  private crouching = false;
  private sprinting = false;

  private moving: Move = { ...zero };

  private walkXActive = false;
  private walkYActive = false;

  private flick: Flick | null = null;

  private gestureBlockedUntil = 0;
  private overrideUntil = 0;
  private overrideMove: Move = { ...zero };

  // Sprint twist state
  private twistAngle = 0;
  private twistPeakRate = 0;
  private twistArmed = true;
  private twistLockedUntil = 0;
  private twistInProgress = false;
  private twistMoveAtStart: Move = { ...zero };

  // Gunner state
  private armed = false;
  private gunnerLockedUntil = 0;
  private stillSince: number | null = null;
  private aimFrozenUntil = 0;

  private debug: MotionDebug = emptyDebug();

  constructor(
    private readonly role: Role,
    private readonly platform: string = "ios"
  ) {}

  reset(): void {
    this.calibrationSince = null;

    this.gravitySum = {
      x: 0,
      y: 0,
      z: 0,
    };

    this.calibrationCount = 0;
    this.frame = null;
    this.gravity = null;
    this.lastSampleAt = null;

    this.crouching = false;
    this.sprinting = false;

    this.moving = { ...zero };

    this.walkXActive = false;
    this.walkYActive = false;

    this.flick = null;
    this.gestureBlockedUntil = 0;

    this.overrideUntil = 0;
    this.overrideMove = { ...zero };

    this.twistAngle = 0;
    this.twistPeakRate = 0;
    this.twistArmed = true;
    this.twistLockedUntil = 0;
    this.twistInProgress = false;
    this.twistMoveAtStart = { ...zero };

    this.armed = false;
    this.gunnerLockedUntil = 0;
    this.stillSince = null;
    this.aimFrozenUntil = 0;

    this.debug = emptyDebug();
  }

  getDebug(): MotionDebug {
    return { ...this.debug };
  }

  getOrientation(): {
    frame: Frame;
    gravity: MotionVector;
  } | null {
    if (!this.frame || !this.gravity) {
      return null;
    }

    return {
      frame: {
        ...this.frame,
        down: { ...this.frame.down },
        up: { ...this.frame.up },
        right: { ...this.frame.right },
        away: { ...this.frame.away },
      },
      gravity: { ...this.gravity },
    };
  }

  process(
    reading: MotionReading,
    now = Date.now()
  ): GameControls {
    const total = reading.accelerationIncludingGravity;
    const acceleration = reading.acceleration;
    const rate = reading.rotationRate;

    if (
      !total ||
      !validVector(total) ||
      magnitude(total) < 0.1 ||
      (acceleration && !validVector(acceleration)) ||
      (
        rate &&
        ![
          rate.alpha,
          rate.beta,
          rate.gamma,
        ].every(Number.isFinite)
      )
    ) {
      return {
        ...emptyControls,
        ready: this.frame !== null,
        crouch: this.crouching,
        sprint: this.sprinting,
      };
    }

    const stamp =
      rate?.timestamp ??
      reading.rotation?.timestamp;

    const t =
      typeof stamp === "number" &&
      Number.isFinite(stamp)
        ? stamp * 1000
        : now;

    if (
      this.lastSampleAt !== null &&
      t <= this.lastSampleAt
    ) {
      return {
        ...emptyControls,
        ready: this.frame !== null,
        crouch: this.crouching,
        sprint: this.sprinting,
      };
    }

    const elapsed =
      this.lastSampleAt === null
        ? 0
        : (t - this.lastSampleAt) / 1000;

    const dt = limit(
      elapsed || 0.016,
      0.005,
      0.08
    );

    this.lastSampleAt = t;

    if (elapsed > 0.35) {
      this.flick = null;
      this.moving = { ...zero };
      this.walkXActive = false;
      this.walkYActive = false;
    }

    const gravity = this.updateGravity(
      reading,
      dt
    );

    const gyro = rate
      ? deviceRotationRate(rate, this.platform)
      : null;

    const angularSpeed = gyro
      ? magnitude(gyro)
      : 0;

    // Initial calibration
    if (!this.frame) {
      const isStill =
        angularSpeed <=
          settings.calibrationMaxRate &&
        (
          !acceleration ||
          magnitude(acceleration) <=
            settings.calibrationMaxLinear
        );

      if (isStill) {
        if (this.calibrationSince === null) {
          this.calibrationSince = t;

          this.gravitySum = {
            x: 0,
            y: 0,
            z: 0,
          };

          this.calibrationCount = 0;
        }

        this.gravitySum = {
          x: this.gravitySum.x + gravity.x,
          y: this.gravitySum.y + gravity.y,
          z: this.gravitySum.z + gravity.z,
        };

        this.calibrationCount++;

        if (
          t - this.calibrationSince >=
            settings.calibrationMs &&
          this.calibrationCount >= 8
        ) {
          this.frame = buildFrame(
            normalize(this.gravitySum)
          );

          this.debug.calibration = "ready";
          this.debug.grip = this.frame.grip;
          this.armed = true;
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
      ? this.processMovement(
          gravity,
          this.frame,
          rates,
          t,
          dt
        )
      : this.processGunner(
          reading,
          gravity,
          this.frame,
          rates,
          angularSpeed,
          t,
          dt
        );
  }

  private updateGravity(
    reading: MotionReading,
    dt: number
  ): MotionVector {
    const total = reading.accelerationIncludingGravity;
    const linear = reading.acceleration;

    const estimate = linear
      ? {
          x: total.x - linear.x,
          y: total.y - linear.y,
          z: total.z - linear.z,
        }
      : total;

    const sample =
      magnitude(estimate) > 1
        ? normalize(estimate)
        : normalize(total);

    const tau = linear
      ? settings.gravityTauWithLinear
      : settings.gravityTauWithoutLinear;

    const k = 1 - Math.exp(-dt / tau);

    this.gravity = this.gravity
      ? normalize({
          x:
            this.gravity.x +
            k * (sample.x - this.gravity.x),

          y:
            this.gravity.y +
            k * (sample.y - this.gravity.y),

          z:
            this.gravity.z +
            k * (sample.z - this.gravity.z),
        })
      : sample;

    return this.gravity;
  }

  // Walking deadzone and hysteresis
  private walkAxis(
    degrees: number,
    wasActive: boolean
  ): {
    value: number;
    active: boolean;
  } {
    const abs = Math.abs(degrees);

    const threshold = wasActive
      ? settings.walkExitDeadzone
      : settings.walkEnterDeadzone;

    const active = abs > threshold;

    if (!active) {
      return {
        value: 0,
        active: false,
      };
    }

    const portion = limit(
      (
        abs -
        settings.walkExitDeadzone
      ) /
        (
          settings.fullSpeedDeg -
          settings.walkExitDeadzone
        ),
      0,
      1
    );

    return {
      value:
        Math.sign(degrees) *
        Math.pow(portion, 0.86),

      active: true,
    };
  }

  // ===================================
  // MOVEMENT PHONE
  // ===================================

  private processMovement(
    gravity: MotionVector,
    frame: Frame,
    rates: PlayerRates | null,
    t: number,
    dt: number
  ): GameControls {
    const forwardDeg =
      -axes.forwardSign *
      rotationAbout(
        frame.down,
        gravity,
        frame.right
      );

    const rightDeg =
      axes.rightSign *
      rotationAbout(
        frame.down,
        gravity,
        frame.away
      );

    this.debug.pitchDeg = forwardDeg;
    this.debug.sidePressDeg = rightDeg;

    let action: Action = null;

    if (rates) {
      action = this.updateTwist(
        rates,
        t,
        dt
      );

      if (action) {
        this.flick = null;

        this.gestureBlockedUntil =
          t + settings.gestureCooldownMs;

        this.overrideMove = {
          ...this.moving,
        };

        this.overrideUntil =
          t + settings.postFlickHoldMs;
      } else {
        action = this.updateFlick(
          rates,
          forwardDeg,
          t,
          dt
        );
      }
    } else {
      this.flick = null;
    }

    const axisX = this.walkAxis(
      rightDeg,
      this.walkXActive
    );

    const axisY = this.walkAxis(
      forwardDeg,
      this.walkYActive
    );

    this.walkXActive = axisX.active;
    this.walkYActive = axisY.active;

    let target: Move = {
      x: axisX.value,
      y: axisY.value,
    };

    // Normalize diagonal movement
    const size = Math.hypot(
      target.x,
      target.y
    );

    if (size > 1) {
      target = {
        x: target.x / size,
        y: target.y / size,
      };
    }

    // Keep movement while performing gestures
    if (this.flick) {
      target = this.flick.moveAtStart;
    } else if (this.twistInProgress) {
      target = this.twistMoveAtStart;
    } else if (t < this.overrideUntil) {
      target = this.overrideMove;
    }

    const next = (
      axis: "x" | "y"
    ): number => {
      const oldValue = this.moving[axis];
      const targetValue = target[axis];

      const tau =
        Math.abs(targetValue) >
        Math.abs(oldValue)
          ? settings.movementRiseTau
          : settings.movementFallTau;

      const value = blend(
        oldValue,
        targetValue,
        dt,
        tau
      );

      return (
        Math.abs(value) < 0.008 &&
        targetValue === 0
      )
        ? 0
        : value;
    };

    this.moving = {
      x: next("x"),
      y: next("y"),
    };

    this.debug.burst = this.flick
      ? "pitch"
      : "none";

    this.debug.gesture =
      t < this.gestureBlockedUntil
        ? "locked"
        : "armed";

    this.debug.sprintPhase =
      this.sprinting
        ? "on"
        : "off";

    return {
      ...emptyControls,

      ready: true,

      moveX: this.moving.x,
      moveY: this.moving.y,

      sprint: this.sprinting,
      crouch: this.crouching,

      action,
    };
  }

  // ===================================
  // CROUCH / JUMP FLICK DETECTION
  // ===================================

  private updateFlick(
    rates: PlayerRates,
    pitch: number,
    t: number,
    dt: number
  ): Action {
    const pitchRate =
      -axes.forwardSign *
      rates.x;

    const otherRate = Math.max(
      Math.abs(rates.y),
      Math.abs(rates.z)
    );

    if (!this.flick) {
      if (
        t < this.gestureBlockedUntil ||
        Math.abs(pitchRate) <
          settings.flickStartRate ||
        Math.abs(pitchRate) <
          otherRate *
            settings.flickAxisDominance
      ) {
        return null;
      }

      this.flick = {
        startedAt: t,
        lastActiveAt: t,
        startPitch: pitch,

        direction: Math.sign(pitchRate),

        progress: 0,
        furthest: 0,

        peakPitchRate: 0,
        peakOtherRate: 0,
        otherTravel: 0,

        moveAtStart: {
          ...this.moving,
        },
      };
    }

    const f = this.flick;

    f.progress +=
      f.direction *
      pitchRate *
      dt;

    f.furthest = Math.max(
      f.furthest,
      f.progress
    );

    f.peakPitchRate = Math.max(
      f.peakPitchRate,
      Math.abs(pitchRate)
    );

    f.peakOtherRate = Math.max(
      f.peakOtherRate,
      otherRate
    );

    f.otherTravel += otherRate * dt;

    if (
      Math.abs(pitchRate) >=
      settings.flickQuietRate
    ) {
      f.lastActiveAt = t;
    }

    const recovered =
      f.furthest - f.progress;

    const travelEnough =
      f.furthest >=
      settings.flickMinTravel;

    const returned =
      recovered >=
      Math.max(
        settings.flickMinReturn,
        f.furthest *
          settings.flickReturnFraction
      );

    const nearStartingAngle =
      Math.abs(pitch - f.startPitch) <=
      settings.flickReturnNearStart;

    const predominantlyPitch =
      f.peakPitchRate >=
        settings.flickPeakRate &&

      f.peakPitchRate >=
        f.peakOtherRate *
          settings.flickAxisDominance &&

      f.furthest >=
        f.otherTravel *
          settings.flickAxisDominance;

    if (
      travelEnough &&
      returned &&
      nearStartingAngle &&
      predominantlyPitch &&
      t - f.startedAt <=
        settings.flickMaxMs
    ) {
      const direction = f.direction;

      this.overrideMove = f.moveAtStart;

      this.overrideUntil =
        t + settings.postFlickHoldMs;

      this.gestureBlockedUntil =
        t + settings.gestureCooldownMs;

      this.flick = null;

      // Forward flick = toggle crouch
      if (direction > 0) {
        this.crouching =
          !this.crouching;

        if (this.crouching) {
          this.sprinting = false;
        }

        return "crouch";
      }

      // Backward flick = jump
      // Also works while sprinting/walking
      this.crouching = false;

      return "jump";
    }

    const timedOut =
      t - f.startedAt >=
      settings.flickMaxMs;

    const settledWithoutReturn =
      t - f.lastActiveAt >=
      settings.flickQuietMs;

    if (
      timedOut ||
      settledWithoutReturn
    ) {
      this.flick = null;
    }

    return null;
  }

  // ===================================
  // SPRINT TWIST DETECTION
  // ===================================

  private updateTwist(
    rates: PlayerRates,
    t: number,
    dt: number
  ): Action {
    const twistSpeed =
      Math.abs(rates.z);

    const otherRate = Math.max(
      Math.abs(rates.x),
      Math.abs(rates.y)
    );

    // Sprint requires dominant screen-normal twist
    const pureTwist =
      twistSpeed >=
        settings.twistIgnoreRate &&

      twistSpeed >=
        otherRate *
          settings.twistDominance;

    if (pureTwist) {
      if (
        !this.twistInProgress &&
        twistSpeed >=
          settings.twistPeakRate
      ) {
        this.twistInProgress = true;

        this.twistMoveAtStart = {
          ...this.moving,
        };
      }

      this.twistAngle = limit(
        this.twistAngle +
          rates.z * dt,
        -150,
        150
      );

      this.twistPeakRate = Math.max(
        this.twistPeakRate,
        twistSpeed
      );
    }

    if (
      Math.abs(this.twistAngle) <=
        settings.twistRearmDeg &&
      t >= this.twistLockedUntil
    ) {
      this.twistInProgress = false;
      this.twistArmed = true;
      this.twistPeakRate = 0;
    }

    if (
      !this.twistArmed ||
      t < this.twistLockedUntil ||
      t < this.gestureBlockedUntil ||
      !pureTwist ||
      Math.abs(this.twistAngle) <
        settings.twistTriggerDeg ||
      this.twistPeakRate <
        settings.twistPeakRate ||
      this.flick
    ) {
      return null;
    }

    this.twistArmed = false;

    this.twistLockedUntil =
      t + settings.twistCooldownMs;

    this.twistPeakRate = 0;

    this.sprinting =
      !this.sprinting;

    if (this.sprinting) {
      this.crouching = false;
    }

    return "sprint";
  }

  // ===================================
  // GUNNER PHONE
  // ===================================

  private processGunner(
    reading: MotionReading,
    gravity: MotionVector,
    frame: Frame,
    rates: PlayerRates | null,
    angularSpeed: number,
    t: number,
    dt: number
  ): GameControls {
    const total =
      reading.accelerationIncludingGravity;

    const linear =
      reading.acceleration ?? {
        x:
          total.x -
          gravity.x * 9.80665,

        y:
          total.y -
          gravity.y * 9.80665,

        z:
          total.z -
          gravity.z * 9.80665,
      };

    const linearMagnitude =
      magnitude(linear);

    // Twist changes weapon for gunner
    let action: Action =
      rates &&
      this.updateTwist(rates, t, dt)
        ? "weapon_next"
        : null;

    if (this.role !== "movement") {
      this.sprinting = false;
    }

    // Re-arm after firing
    if (!this.armed) {
      const settled =
        t >= this.gunnerLockedUntil &&

        linearMagnitude <
          settings.rearmAcceleration &&

        angularSpeed <
          settings.rearmRotation;

      if (settled) {
        if (this.stillSince === null) {
          this.stillSince = t;
        }

        if (
          t - this.stillSince >=
          settings.rearmStillMs
        ) {
          this.armed = true;
        }
      } else {
        this.stillSince = null;
      }
    }

    // Detect shot / scope / reload
    if (
      this.armed &&
      !action &&
      angularSpeed <
        settings.gestureMaxRotation
    ) {
      const forwardImpulse =
        axes.forwardJabZSign *
        linear.z;

      const liftImpulse = dot(
        linear,
        scale(frame.down, -1)
      );

      if (
        Math.abs(forwardImpulse) >=
          settings.jabThreshold &&

        Math.abs(forwardImpulse) >
          0.75 * linearMagnitude
      ) {
        action =
          forwardImpulse > 0
            ? "shoot"
            : "scope";
      } else if (
        liftImpulse >=
          settings.liftThreshold &&

        liftImpulse >
          0.75 * linearMagnitude
      ) {
        action = "reload";
      }
    }

    if (action) {
      this.aimFrozenUntil =
        t +
        settings.aimFreezeAfterShotMs;

      this.armed = false;

      this.gunnerLockedUntil =
        t +
        settings.gunnerCooldownMs;

      this.stillSince = null;
    }

    this.debug.gesture =
      this.armed
        ? "armed"
        : "locked";

    const output: GameControls = {
      ...emptyControls,
      ready: true,
      action,
    };

    // Camera aiming
    if (
      rates &&
      t >= this.aimFrozenUntil
    ) {
      output.lookX = gyroToMovement(
        axes.gunnerYawSign *
        rates.y
      );

      output.lookY = gyroToMovement(
        axes.gunnerPitchSign *
        rates.x
      );
    }

    return output;
  }
}
