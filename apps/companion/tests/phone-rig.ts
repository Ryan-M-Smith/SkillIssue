// A virtual phone for tests (from the Motion Bench page). Rotates in 3D and reports
// readings in expo-sensors DeviceMotion format for the chosen platform.
type M = number[][];
export type V3 = [number, number, number];
export type Grip = "landscape-left" | "landscape-right" | "portrait";
export type Pose = { fwd: number; right: number; twist: number; yaw: number };

const D2R = Math.PI / 180;
const mul = (a: M, b: M): M => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const T = (a: M): M => [0, 1, 2].map((i) => [a[0][i], a[1][i], a[2][i]]);
const mv = (a: M, v: V3): V3 => [0, 1, 2].map((i) => a[i][0] * v[0] + a[i][1] * v[1] + a[i][2] * v[2]) as V3;
const rot = (axis: "x" | "y" | "z", deg: number): M => {
  const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R);
  if (axis === "x") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === "y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const cols = (x: V3, y: V3, z: V3): M => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
const c45 = Math.SQRT1_2;

// World: X = player's right, Y = away from player, Z = up.
// Phone tilted 45°, screen toward the player. Columns = phone X, Y, Z axes.
export const GRIP_BASES: Record<Grip, M> = {
  "landscape-left": cols([0, c45, c45], [-1, 0, 0], [0, -c45, c45]),
  "landscape-right": cols([0, -c45, -c45], [1, 0, 0], [0, -c45, c45]),
  portrait: cols([1, 0, 0], [0, c45, c45], [0, -c45, c45]),
};

export const neutralPose = (): Pose => ({ fwd: 0, right: 0, twist: 0, yaw: 0 });

const noise = (a: number) => (Math.random() - 0.5) * 2 * a;

export class PhoneRig {
  base: M;
  R: M;
  pose: Pose = neutralPose();
  t = 1000; // sensor clock, seconds
  tremor = true;
  linear = true;

  constructor(public grip: Grip = "landscape-left", public platform = "ios") {
    this.base = GRIP_BASES[grip];
    this.R = this.orient(this.pose);
  }

  orient(p: Pose): M {
    // forward = top edge away = negative rotation about world X;
    // right end down = positive rotation about world Y (away);
    // twist = rotation about the phone's own Z (screen normal).
    return mul(rot("z", p.yaw), mul(rot("y", p.right), mul(rot("x", -p.fwd), mul(this.base, rot("z", p.twist)))));
  }

  setGrip(grip: Grip) {
    this.grip = grip;
    this.base = GRIP_BASES[grip];
    this.R = this.orient(this.pose); // jump without reporting a rotation
  }

  /** Advance the sensor clock by dtMs with the phone now at `p`. */
  step(p: Pose, dtMs = 20) {
    const R = this.orient(p);
    const d = mul(T(this.R), R);
    this.R = R;
    this.pose = { ...p };
    const dt = dtMs / 1000;
    let gyro = [(d[2][1] - d[1][2]) / 2, (d[0][2] - d[2][0]) / 2, (d[1][0] - d[0][1]) / 2]
      .map((v) => Math.asin(Math.max(-1, Math.min(1, v))) / D2R / dt) as V3;
    if (this.tremor) gyro = gyro.map((v) => v + noise(5)) as V3;
    const gravity = mv(T(R), [0, 0, -9.81]).map((v) => v + (this.tremor ? noise(0.04) : 0)) as V3;
    this.t += dt;
    const [x, y, z] = gyro;
    const packed =
      this.platform === "android" ? { alpha: x, beta: y, gamma: z }
      : this.platform === "web" ? { alpha: z, beta: x, gamma: y }
      : { alpha: z, beta: y, gamma: x };
    const ts = { timestamp: this.t };
    const reading = {
      rotation: { alpha: Math.atan2(-R[0][1], R[1][1]), beta: Math.asin(Math.max(-1, Math.min(1, R[2][1]))), gamma: Math.atan2(-R[2][0], R[2][2]), ...ts },
      rotationRate: { ...packed, ...ts },
      acceleration: this.linear ? { x: 0, y: 0, z: 0, ...ts } : null,
      accelerationIncludingGravity: { x: gravity[0], y: gravity[1], z: gravity[2], ...ts },
      interval: dtMs,
      orientation: 0,
    };
    return { reading, gyro, gravity, R };
  }
}
