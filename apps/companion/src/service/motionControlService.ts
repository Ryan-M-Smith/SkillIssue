
/**
 * Motion-control engine for the landscape phone controller.
 *
 * No Expo / React imports. Feed Expo DeviceMotion measurements into process().
 * Optional pose comes from a separate AR/native tracker (NOT Expo DeviceMotion).
 *
 * MOVEMENT PHONE:
 * - Slow forward/back tilt                  => moveY
 * - Real horizontal phone translation       => moveX (requires optional pose)
 * - Fast backward pitch flick               => jump (one-shot)
 * - Fast forward pitch flick                => crouch (one-shot + timed hold)
 * - Fast alternation of RIGHT-DOWN/LEFT-DOWN=> sprint latch
 *
 * GUNNER PHONE:
 * - Gyroscope                              => lookX / lookY
 * - Quick forward jab                       => shoot (one-shot)
 *
 * DeviceMotion.rotationRate is DEGREES/SECOND in Expo.
 * Native axes do NOT automatically follow the screen's landscape rotation.
 * For the standard landscape grip: device X is the phone's short axis,
 * device Y its long axis. The side-press sprint twists around device X,
 * while the forward/backward pitch rotates around device Y.
 */

export type Role = "movement" | "gunner";
export type Action = "jump" | "crouch" | "shoot" | null;
export type Vector3 = { x: number; y: number; z: number };
export type Angles = { alpha: number; beta: number; gamma: number };

/** World coordinates MUST be meters. `right` is a world-space unit direction
 * pointing to the player's physical right AT THE INITIAL RESTING POSE.
 * A native AR integration must supply both position and right vector.
 */
export type TrackedPose = {
  position: Vector3;
  right: Vector3;
  trackingState: "tracking" | "limited" | "unavailable";
};

/** Compatible with Expo DeviceMotionMeasurement, with an optional AR pose. */
export type MotionReading = {
  acceleration: Vector3 | null;                 // m/s^2, gravity excluded
  accelerationIncludingGravity: Vector3;        // m/s^2
  rotationRate: Angles | null;                   // degrees/s (Expo)
  rotation?: Angles;                             // radians; not required
  pose?: TrackedPose | null;                     // OPTIONAL, native AR only
};

export type GameControls = {
  ready: boolean;
  moveX: number; // -1 left, +1 right
  moveY: number; // -1 backward, +1 forward
  sprint: boolean;
  crouch: boolean;
  lookX: number;
  lookY: number;
  action: Action; // ONLY on the frame when it fires
};

export const EMPTY_CONTROLS: GameControls = {
  ready: false, moveX: 0, moveY: 0, sprint: false, crouch: false,
  lookX: 0, lookY: 0, action: null,
};

/** Flip signs only after checking real sensor values in your landscape grip. */
export const MOTION_AXES = {
  forwardTiltSign: 1,
  strafeSign: 1,
  gunnerYawSign: 1,
  gunnerPitchSign: -1,
  gunnerForwardJabSign: -1, // jab away from player's chest
};

/** Initial thresholds: tune from recordings on the actual phones. */
export const MOTION_TUNING = {
  calibrationMs: 850,
  calibrationMaxLinear: 0.85,    // m/s^2
  calibrationMaxGyro: 13,       // deg/s
  calibrationGravityMin: 7.0,   // m/s^2
  calibrationGravityMax: 12.5,
  driftIdleMs: 900,
  driftMaxPitchDeg: 3.0,        // correct ONLY small drift inside deadzone
  driftMaxRollDeg: 3.0,
  driftMaxGyro: 8,
  driftMaxLinear: 0.45,
  driftCorrectionRate: 0.008,

  walkDeadzoneDeg: 5.5,
  walkFullScaleDeg: 27,
  walkSmoothingSeconds: 0.090,
  pitchGestureRate: 100,        // deg/s (must be predominantly pitch)
  pitchGestureAngle: 8.5,      // degrees of travel since beginning of flick
  pitchGestureMaxMs: 230,
  pitchGestureCooldownMs: 670,
  pitchGestureRearmMs: 160,
  pitchDominance: 1.25,
  pitchFreezeAfterActionMs: 180,
  crouchDurationMs: 1100,

  sprintFirstRate: 95,          // deg/s around device X
  sprintReverseRate: 75,        // deg/s, opposite direction
  sprintFirstAngle: 9,         // degrees of travel in first direction
  sprintOppositeAngle: 5.5,    // must CROSS original position, not just recover
  sprintPhaseOneMaxMs: 220,
  sprintWholeGestureMaxMs: 560,
  sprintDominance: 1.25,
  sprintCooldownMs: 750,
  sprintStrafeFreezeMs: 130,
  sprintStopAfterIdleMs: 550,
  sprintStartGraceMs: 1500,

  positionAnchorStillMs: 300,
  strafeDeadzoneMeters: 0.027,
  strafeFullScaleMeters: 0.145,
  strafeSmoothingSeconds: 0.080,
  positionTinyDriftMeters: 0.014,
  positionDriftCorrectionRate: 0.01,
  positionJumpMeters: 0.35,    // reject big AR relocalization discontinuities

  gunnerAimDeadzoneDegPerSec: 3.5,
  gunnerAimMaxDegPerSec: 140,
  gunnerShootJabMps2: 5.0,
  gunnerShootCooldownMs: 520,
  gunnerShootAimFreezeMs: 100,
};

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const norm = (v: Vector3) => Math.hypot(v.x, v.y, v.z);

const dot = (a: Vector3, b: Vector3) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

const subtract = (a: Vector3, b: Vector3): Vector3 =>
  ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

const lerpVector = (a: Vector3, b: Vector3, alpha: number): Vector3 =>
  ({
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha
  });

const deg = (r: number) => r * 180 / Math.PI;

const expSmooth = (dt: number, seconds: number) =>
  1 - Math.exp(-dt / seconds);

const isVector = (
  v: Vector3 | undefined | null
): v is Vector3 =>
  !!v &&
  Number.isFinite(v.x) &&
  Number.isFinite(v.y) &&
  Number.isFinite(v.z);

const isRate = (r: Angles | null): r is Angles =>
  !!r &&
  Number.isFinite(r.alpha) &&
  Number.isFinite(r.beta) &&
  Number.isFinite(r.gamma);

const gyroMag = (r: Angles | null) =>
  isRate(r)
    ? Math.hypot(r.alpha, r.beta, r.gamma)
    : Infinity;

/**
 * Signed difference in degrees between 2 vectors projected to a 2D plane.
 * Cross/dot avoids Euler wrapping and mostly isolates the desired axis.
 */
function planeAngle(
  neutralA: number,
  neutralZ: number,
  a: number,
  z: number
): number {
  return deg(
    Math.atan2(
      a * neutralZ - z * neutralA,
      a * neutralA + z * neutralZ
    )
  );
}

function toAxis(
  value: number,
  deadzone: number,
  fullScale: number
): number {
  const v = Math.abs(value);

  if (v <= deadzone) return 0;

  return Math.sign(value) *
    clamp((v - deadzone) / (fullScale - deadzone), 0, 1);
}

function toAim(rate: number) {
  const v = Math.abs(rate);

  if (v < MOTION_TUNING.gunnerAimDeadzoneDegPerSec) {
    return 0;
  }

  return Math.sign(rate) *
    clamp(
      (v - MOTION_TUNING.gunnerAimDeadzoneDegPerSec) /
      (
        MOTION_TUNING.gunnerAimMaxDegPerSec -
        MOTION_TUNING.gunnerAimDeadzoneDegPerSec
      ),
      0,
      1
    );
}

type PitchCandidate = {
  startedAt: number;
  origin: number;
};

type SprintCandidate = {
  startedAt: number;
  origin: number;
  firstRateSign: number;
  stage: "first" | "reverse";
  firstAngleSign: number;
  reverseRateSeen: boolean;
};

export type MotionDebug = {
  calibration: "calibrating" | "ready";
  pitchDeg: number;
  sidePressDeg: number;
  pitchRate: number;
  sidePressRate: number;
  sprintPhase: "idle" | "first" | "reverse" | "cooldown";
  strafeMeters: number;
  positionTracking: "tracking" | "limited" | "unavailable" | "missing";
};

export class MotionController {
  private neutralGravity: Vector3 | null = null;
  private calibratingGravity: Vector3 | null = null;
  private calibrationSince: number | null = null;
  private lastSampleAt: number | null = null;
  private driftStillSince: number | null = null;

  private smoothForward = 0;
  private pitchCandidate: PitchCandidate | null = null;
  private pitchLockedUntil = 0;
  private pitchRearmSince: number | null = null;
  private pitchArmed = true;
  private pitchFreezeUntil = 0;
  private pitchHeldY = 0;
  private crouchUntil = 0;

  private sprintCandidate: SprintCandidate | null = null;
  private sprintCooldownUntil = 0;
  private sprintStrafeFreezeUntil = 0;
  private sprintLatched = false;
  private sprintLatchedAt = 0;
  private sprintSawForward = false;
  private sprintForwardStoppedAt: number | null = null;

  private neutralPosition: Vector3 | null = null;
  private rightBasis: Vector3 | null = null;
  private positionAnchorSince: number | null = null;
  private positionNearNeutralSince: number | null = null;
  private lastTrackedPosition: Vector3 | null = null;
  private smoothStrafe = 0;
  private strafeMeters = 0;

  private shootLockedUntil = 0;
  private shootRearmSince: number | null = null;
  private shootArmed = true;
  private aimFreezeUntil = 0;

  private debug: MotionDebug = {
    calibration: "calibrating",
    pitchDeg: 0,
    sidePressDeg: 0,
    pitchRate: 0,
    sidePressRate: 0,
    sprintPhase: "idle",
    strafeMeters: 0,
    positionTracking: "missing",
  };

  constructor(private readonly role: Role) {}

  /**
   * Call on player request, round restart, or a major grip/orientation change.
   * Recalibrates neutral from a new stable ~850ms hold.
   */
  reset(): void {
    this.neutralGravity = null;
    this.calibratingGravity = null;
    this.calibrationSince = null;
    this.lastSampleAt = null;
    this.driftStillSince = null;

    this.smoothForward = 0;
    this.pitchCandidate = null;
    this.pitchLockedUntil = 0;
    this.pitchRearmSince = null;
    this.pitchArmed = true;
    this.pitchFreezeUntil = 0;
    this.pitchHeldY = 0;
    this.crouchUntil = 0;

    this.sprintCandidate = null;
    this.sprintCooldownUntil = 0;
    this.sprintStrafeFreezeUntil = 0;
    this.sprintLatched = false;
    this.sprintLatchedAt = 0;
    this.sprintSawForward = false;
    this.sprintForwardStoppedAt = null;

    this.resetPositionAnchor();

    this.shootLockedUntil = 0;
    this.shootRearmSince = null;
    this.shootArmed = true;
    this.aimFreezeUntil = 0;

    this.debug = {
      calibration: "calibrating",
      pitchDeg: 0,
      sidePressDeg: 0,
      pitchRate: 0,
      sidePressRate: 0,
      sprintPhase: "idle",
      strafeMeters: 0,
      positionTracking: "missing",
    };
  }

  /** Useful for a live threshold/debug UI. */
  getDebug(): MotionDebug {
    return { ...this.debug };
  }

  private resetPositionAnchor(): void {
    this.neutralPosition = null;
    this.rightBasis = null;
    this.positionAnchorSince = null;
    this.positionNearNeutralSince = null;
    this.lastTrackedPosition = null;
    this.smoothStrafe = 0;
    this.strafeMeters = 0;
  }

  private isStable(
    reading: MotionReading,
    maxLinear: number,
    maxRate: number
  ): boolean {
    // Missing gyro is allowed for calibration, but gestures require it.
    return (
      (!reading.acceleration ||
        norm(reading.acceleration) < maxLinear) &&
      (!reading.rotationRate ||
        gyroMag(reading.rotationRate) < maxRate)
    );
  }

  /** Estimate gravity in device axes. */
  private gravity(reading: MotionReading): Vector3 | null {
    const total = reading.accelerationIncludingGravity;

    if (!isVector(total)) return null;

    const g = reading.acceleration && isVector(reading.acceleration)
      ? subtract(total, reading.acceleration)
      : total;

    const length = norm(g);

    if (
      !Number.isFinite(length) ||
      length < MOTION_TUNING.calibrationGravityMin ||
      length > MOTION_TUNING.calibrationGravityMax
    ) {
      return null;
    }

    return {
      x: g.x / length,
      y: g.y / length,
      z: g.z / length,
    };
  }

  private calibrate(
    reading: MotionReading,
    g: Vector3,
    now: number
  ): boolean {
    if (this.neutralGravity) return true;

    if (
      !this.isStable(
        reading,
        MOTION_TUNING.calibrationMaxLinear,
        MOTION_TUNING.calibrationMaxGyro
      )
    ) {
      this.calibrationSince = null;
      this.calibratingGravity = null;
      return false;
    }

    if (this.calibrationSince === null) {
      this.calibrationSince = now;
      this.calibratingGravity = g;
      return false;
    }

    this.calibratingGravity = lerpVector(
      this.calibratingGravity ?? g,
      g,
      0.12
    );

    if (
      now - this.calibrationSince <
      MOTION_TUNING.calibrationMs
    ) {
      return false;
    }

    this.neutralGravity = this.calibratingGravity;
    return true;
  }

  /**
   * Never re-center held deliberate tilts.
   * Only correct noise within the deadzone.
   */
  private adjustSmallNeutralDrift(
    reading: MotionReading,
    g: Vector3,
    pitch: number,
    sidePress: number,
    now: number
  ): void {
    const safelyIdle =
      Math.abs(pitch) < MOTION_TUNING.driftMaxPitchDeg &&
      Math.abs(sidePress) < MOTION_TUNING.driftMaxRollDeg &&
      !this.pitchCandidate &&
      !this.sprintCandidate &&
      now >= this.pitchLockedUntil &&
      now >= this.sprintCooldownUntil &&
      this.isStable(
        reading,
        MOTION_TUNING.driftMaxLinear,
        MOTION_TUNING.driftMaxGyro
      );

    if (!safelyIdle) {
      this.driftStillSince = null;
      return;
    }

    if (this.driftStillSince === null) {
      this.driftStillSince = now;
    }

    if (
      now - this.driftStillSince >=
        MOTION_TUNING.driftIdleMs &&
      this.neutralGravity
    ) {
      this.neutralGravity = lerpVector(
        this.neutralGravity,
        g,
        MOTION_TUNING.driftCorrectionRate
      );
    }
  }

  /**
   * Recognize a fast pitch excursion, not instantaneous acceleration.
   * Return stroke cannot become a second action until cooldown and rearm.
   */
  private detectPitch(
    reading: MotionReading,
    pitch: number,
    now: number
  ): Action {
    const r = reading.rotationRate;
    const stable = this.isStable(reading, 1.35, 25);

    if (!this.pitchArmed) {
      if (now >= this.pitchLockedUntil && stable) {
        if (this.pitchRearmSince === null) {
          this.pitchRearmSince = now;
        }

        if (
          now - this.pitchRearmSince >=
          MOTION_TUNING.pitchGestureRearmMs
        ) {
          this.pitchArmed = true;
          this.pitchRearmSince = null;
        }
      } else {
        this.pitchRearmSince = null;
      }
    }

    if (
      !this.pitchArmed ||
      !isRate(r) ||
      !!this.sprintCandidate
    ) {
      this.pitchCandidate = null;
      return null;
    }

    const pitchFast =
      Math.abs(r.beta) >= MOTION_TUNING.pitchGestureRate &&
      Math.abs(r.beta) >=
        MOTION_TUNING.pitchDominance *
        Math.max(Math.abs(r.alpha), Math.abs(r.gamma));

    if (!this.pitchCandidate) {
      if (pitchFast) {
        this.pitchCandidate = {
          startedAt: now,
          origin: pitch,
        };
      }

      return null;
    }

    const elapsed = now - this.pitchCandidate.startedAt;

    if (elapsed > MOTION_TUNING.pitchGestureMaxMs) {
      this.pitchCandidate = null;
      return null;
    }

    const traveled = pitch - this.pitchCandidate.origin;

    const qualifies =
      Math.abs(traveled) >=
        MOTION_TUNING.pitchGestureAngle &&
      Math.abs(r.beta) >=
        MOTION_TUNING.pitchGestureRate * 0.45 &&
      Math.abs(r.beta) >=
        Math.max(
          Math.abs(r.alpha),
          Math.abs(r.gamma)
        ) * 0.9;

    if (!qualifies) return null;

    // Positive walk pitch => fast forward flick crouches.
    // Negative walk pitch => fast backward flick jumps.
    const action: Action =
      traveled > 0 ? "crouch" : "jump";

    if (action === "crouch") {
      this.crouchUntil =
        now + MOTION_TUNING.crouchDurationMs;

      this.sprintLatched = false;
    }

    this.pitchArmed = false;
    this.pitchLockedUntil =
      now + MOTION_TUNING.pitchGestureCooldownMs;

    this.pitchFreezeUntil =
      now + MOTION_TUNING.pitchFreezeAfterActionMs;

    this.pitchRearmSince = null;
    this.pitchCandidate = null;

    return action;
  }

  /**
   * Side press:
   * Right edge down -> left edge down, OR reverse order.
   *
   * Requires TWO distinct opposite excursions across the starting angle.
   * Merely returning from the first excursion to neutral is NOT sufficient.
   */
  private detectSprint(
    reading: MotionReading,
    sidePressDeg: number,
    now: number
  ): boolean {
    const r = reading.rotationRate;

    if (!isRate(r)) {
      this.sprintCandidate = null;
      return false;
    }

    if (now < this.sprintCooldownUntil) {
      return false;
    }

    const dominant =
      Math.abs(r.alpha) >=
      MOTION_TUNING.sprintDominance *
      Math.max(
        Math.abs(r.beta),
        Math.abs(r.gamma)
      );

    const fastFirst =
      dominant &&
      Math.abs(r.alpha) >=
        MOTION_TUNING.sprintFirstRate;

    if (!this.sprintCandidate) {
      if (
        fastFirst &&
        !this.pitchCandidate &&
        this.pitchArmed
      ) {
        this.sprintCandidate = {
          startedAt: now,
          origin: sidePressDeg,
          firstRateSign: Math.sign(r.alpha),
          stage: "first",
          firstAngleSign: 0,
          reverseRateSeen: false,
        };
      }

      return false;
    }

    const candidate = this.sprintCandidate;
    const elapsed = now - candidate.startedAt;

    if (
      elapsed >
      MOTION_TUNING.sprintWholeGestureMaxMs
    ) {
      this.sprintCandidate = null;
      return false;
    }

    const traveled =
      sidePressDeg - candidate.origin;

    if (candidate.stage === "first") {
      if (
        elapsed >
        MOTION_TUNING.sprintPhaseOneMaxMs
      ) {
        this.sprintCandidate = null;
        return false;
      }

      if (
        Math.abs(traveled) >=
        MOTION_TUNING.sprintFirstAngle
      ) {
        candidate.firstAngleSign =
          Math.sign(traveled);

        candidate.stage = "reverse";
      }

      return false;
    }

    // Angular velocity must invert, not only brake.
    if (
      dominant &&
      Math.sign(r.alpha) ===
        -candidate.firstRateSign &&
      Math.abs(r.alpha) >=
        MOTION_TUNING.sprintReverseRate
    ) {
      candidate.reverseRateSeen = true;
    }

    const acrossOrigin =
      traveled * candidate.firstAngleSign <=
      -MOTION_TUNING.sprintOppositeAngle;

    if (
      !candidate.reverseRateSeen ||
      !acrossOrigin
    ) {
      return false;
    }

    this.sprintCandidate = null;

    this.sprintCooldownUntil =
      now + MOTION_TUNING.sprintCooldownMs;

    this.sprintStrafeFreezeUntil =
      now + MOTION_TUNING.sprintStrafeFreezeMs;

    // Repeating the gesture toggles sprint off.
    this.sprintLatched = !this.sprintLatched;

    this.sprintLatchedAt = now;
    this.sprintSawForward = false;
    this.sprintForwardStoppedAt = null;

    return true;
  }

  /**
   * Optional AR position strafe.
   *
   * No double-integrating accelerometer position.
   *
   * Stable HOLD at 10cm right => ongoing strafe right
   * until returning to rest.
   */
  private updateStrafe(
    reading: MotionReading,
    now: number,
    dt: number
  ): number {
    const pose = reading.pose;

    this.debug.positionTracking =
      pose ? pose.trackingState : "missing";

    if (
      !pose ||
      pose.trackingState !== "tracking" ||
      !isVector(pose.position) ||
      !isVector(pose.right) ||
      norm(pose.right) < 0.5
    ) {
      this.resetPositionAnchor();
      return 0;
    }

    if (
      this.lastTrackedPosition &&
      norm(
        subtract(
          pose.position,
          this.lastTrackedPosition
        )
      ) > MOTION_TUNING.positionJumpMeters
    ) {
      // Tracking relocalized. Do not interpret pose jumps as strafing.
      this.resetPositionAnchor();
      this.lastTrackedPosition = pose.position;
      return 0;
    }

    this.lastTrackedPosition = pose.position;

    if (
      !this.neutralPosition ||
      !this.rightBasis
    ) {
      if (!this.isStable(reading, 1.0, 20)) {
        this.positionAnchorSince = null;
        return 0;
      }

      if (this.positionAnchorSince === null) {
        this.positionAnchorSince = now;
      }

      if (
        now - this.positionAnchorSince >=
        MOTION_TUNING.positionAnchorStillMs
      ) {
        this.neutralPosition = {
          ...pose.position,
        };

        const rightLength = norm(pose.right);

        this.rightBasis = {
          x: pose.right.x / rightLength,
          y: pose.right.y / rightLength,
          z: pose.right.z / rightLength,
        };
      }

      return 0;
    }

    const dist =
      dot(
        subtract(
          pose.position,
          this.neutralPosition
        ),
        this.rightBasis
      ) * MOTION_AXES.strafeSign;

    this.strafeMeters = dist;

    // During sprint, preserve the last trustworthy strafe output.
    // Wrist pivot motions can shift the phone center sideways.
    if (
      this.sprintCandidate ||
      now < this.sprintStrafeFreezeUntil
    ) {
      return this.smoothStrafe;
    }

    const target = toAxis(
      dist,
      MOTION_TUNING.strafeDeadzoneMeters,
      MOTION_TUNING.strafeFullScaleMeters
    );

    this.smoothStrafe +=
      (target - this.smoothStrafe) *
      expSmooth(
        dt,
        MOTION_TUNING.strafeSmoothingSeconds
      );

    // Recenter only inside a tiny idle region.
    // Never recenter while holding a deliberate strafe.
    const nearRest =
      Math.abs(dist) <
        MOTION_TUNING.positionTinyDriftMeters &&
      Math.abs(this.smoothStrafe) < 0.05 &&
      this.isStable(
        reading,
        MOTION_TUNING.driftMaxLinear,
        MOTION_TUNING.driftMaxGyro
      );

    if (!nearRest) {
      this.positionNearNeutralSince = null;
    } else {
      if (this.positionNearNeutralSince === null) {
        this.positionNearNeutralSince = now;
      }

      if (
        now - this.positionNearNeutralSince >
        MOTION_TUNING.driftIdleMs
      ) {
        this.neutralPosition = lerpVector(
          this.neutralPosition,
          pose.position,
          MOTION_TUNING.positionDriftCorrectionRate
        );
      }
    }

    return this.smoothStrafe;
  }

  private updateSprintLifetime(
    forward: number,
    now: number
  ): boolean {
    if (
      !this.sprintLatched ||
      now < this.crouchUntil
    ) {
      return false;
    }

    if (forward > 0.15) {
      this.sprintSawForward = true;
      this.sprintForwardStoppedAt = null;
    } else if (this.sprintSawForward) {
      if (this.sprintForwardStoppedAt === null) {
        this.sprintForwardStoppedAt = now;
      }

      if (
        now - this.sprintForwardStoppedAt >=
        MOTION_TUNING.sprintStopAfterIdleMs
      ) {
        this.sprintLatched = false;
      }
    } else if (
      now - this.sprintLatchedAt >=
      MOTION_TUNING.sprintStartGraceMs
    ) {
      // Allow time to pitch forward after performing sprint.
      this.sprintLatched = false;
    }

    return (
      this.sprintLatched &&
      forward > 0.15
    );
  }

  private updateGunner(
    reading: MotionReading,
    now: number,
    result: GameControls
  ): void {
    const r = reading.rotationRate;
    const a = reading.acceleration;

    if (
      this.shootArmed &&
      a &&
      isVector(a)
    ) {
      const jab =
        a.z * MOTION_AXES.gunnerForwardJabSign;

      const strong =
        jab >= MOTION_TUNING.gunnerShootJabMps2 &&
        jab > 1.3 * Math.hypot(a.x, a.y);

      if (strong) {
        result.action = "shoot";
        this.shootArmed = false;

        this.shootLockedUntil =
          now + MOTION_TUNING.gunnerShootCooldownMs;

        this.aimFreezeUntil =
          now + MOTION_TUNING.gunnerShootAimFreezeMs;

        this.shootRearmSince = null;
      }
    }

    if (!this.shootArmed) {
      if (
        now >= this.shootLockedUntil &&
        this.isStable(reading, 1.6, 50)
      ) {
        if (this.shootRearmSince === null) {
          this.shootRearmSince = now;
        }

        if (
          now - this.shootRearmSince >= 130
        ) {
          this.shootArmed = true;
        }
      } else {
        this.shootRearmSince = null;
      }
    }

    if (
      isRate(r) &&
      now >= this.aimFreezeUntil
    ) {
      result.lookX = toAim(
        MOTION_AXES.gunnerYawSign * r.gamma
      );

      result.lookY = toAim(
        MOTION_AXES.gunnerPitchSign * r.beta
      );
    }
  }

  /**
   * Call every DeviceMotion sample.
   * Caller owns sensor subscription and networking.
   */
  process(
    reading: MotionReading,
    now: number = Date.now()
  ): GameControls {
    const elapsed =
      this.lastSampleAt === null
        ? 20
        : now - this.lastSampleAt;

    const dt = clamp(
      elapsed / 1000,
      0.005,
      0.08
    );

    this.lastSampleAt = now;

    if (elapsed > 300) {
      // App backgrounded or skipped many samples.
      this.pitchCandidate = null;
      this.sprintCandidate = null;
    }

    const g = this.gravity(reading);

    if (!g) {
      return {
        ...EMPTY_CONTROLS,
        ready: this.neutralGravity !== null,
      };
    }

    if (!this.calibrate(reading, g, now)) {
      this.debug.calibration = "calibrating";

      return {
        ...EMPTY_CONTROLS,
        ready: false,
      };
    }

    const neutral = this.neutralGravity!;

    const pitch =
      MOTION_AXES.forwardTiltSign *
      planeAngle(
        neutral.x,
        neutral.z,
        g.x,
        g.z
      );

    const sidePress = planeAngle(
      neutral.y,
      neutral.z,
      g.y,
      g.z
    );

    const r = reading.rotationRate;

    this.debug.calibration = "ready";
    this.debug.pitchDeg = pitch;
    this.debug.sidePressDeg = sidePress;
    this.debug.pitchRate = isRate(r) ? r.beta : 0;
    this.debug.sidePressRate = isRate(r) ? r.alpha : 0;

    const result: GameControls = {
      ...EMPTY_CONTROLS,
      ready: true,
    };

    if (this.role === "gunner") {
      this.updateGunner(
        reading,
        now,
        result
      );

      return result;
    }

    // Sprint gets first opportunity to reserve a strong side press.
    this.detectSprint(
      reading,
      sidePress,
      now
    );

    const pitchFlick = this.detectPitch(
      reading,
      pitch,
      now
    );

    result.action = pitchFlick;

    this.adjustSmallNeutralDrift(
      reading,
      g,
      pitch,
      sidePress,
      now
    );

    const wantedForward = toAxis(
      pitch,
      MOTION_TUNING.walkDeadzoneDeg,
      MOTION_TUNING.walkFullScaleDeg
    );

    this.smoothForward +=
      (wantedForward - this.smoothForward) *
      expSmooth(
        dt,
        MOTION_TUNING.walkSmoothingSeconds
      );

    // A fast pitch flick shouldn't jerk walking/backpedaling input.
    const suppressWalk =
      !!this.pitchCandidate ||
      now < this.pitchFreezeUntil;

    if (!suppressWalk) {
      this.pitchHeldY = this.smoothForward;
    }

    result.moveY = suppressWalk
      ? this.pitchHeldY
      : this.smoothForward;

    result.moveX = this.updateStrafe(
      reading,
      now,
      dt
    );

    result.crouch = now < this.crouchUntil;

    result.sprint =
      this.updateSprintLifetime(
        result.moveY,
        now
      ) && !result.crouch;

    this.debug.strafeMeters = this.strafeMeters;

    this.debug.sprintPhase =
      this.sprintCandidate?.stage ??
      (
        now < this.sprintCooldownUntil
          ? "cooldown"
          : "idle"
      );

    return result;
  }
}
