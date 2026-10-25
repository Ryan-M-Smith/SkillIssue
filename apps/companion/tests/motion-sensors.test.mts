import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMotionAccess, type MotionPermissionSensors } from "../src/lib/motion-access-policy.ts";
import { androidMotionReading } from "../src/lib/math/android-motion.ts";
import { deviceRotationRate } from "../src/lib/math/motion.ts";
import { MotionController } from "../src/service/motion-control-service.ts";
import type { MotionReading } from "../src/types/motion.ts";
import { PhoneRig, neutralPose } from "./phone-rig.ts";

function sensors(overrides: Partial<MotionPermissionSensors> = {}): MotionPermissionSensors {
	return { accelerometerAvailable: async () => true, gyroscopeAvailable: async () => true,
		motionAvailable: async () => true, getPermission: async () => ({ granted: true }),
		requestPermission: async () => ({ granted: true }), ...overrides };
}
test("Android works without the unrelated activity permission or fused sensor", async () => {
	const forbidden = async () => { throw new Error("Activity permission must not be used"); };
	const native = sensors({ getPermission: forbidden, requestPermission: forbidden, motionAvailable: forbidden });
	assert.equal(await resolveMotionAccess("android", false, native), "granted");
	assert.equal(await resolveMotionAccess("android", true, native), "granted");
});
test("missing Android gyro is reported unavailable rather than permission denied", async () => {
	assert.equal(await resolveMotionAccess("android", true, sensors({ gyroscopeAvailable: async () => false })), "unavailable");
});
test("iOS denied permission remains blocked and browser permission precedes probe", async () => {
	assert.equal(await resolveMotionAccess("ios", true, sensors({ requestPermission: async () => ({ granted: false, canAskAgain: false }) })), "blocked");
	const calls: string[] = [];
	assert.equal(await resolveMotionAccess("web", true, sensors({
		requestPermission: async () => { calls.push("request"); return { granted: true }; },
		motionAvailable: async () => { calls.push("probe"); return true; },
	})), "granted");
	assert.deepEqual(calls, ["request", "probe"]);
});
test("Android raw g and radians become gravity-down m/s² and degrees exactly once", () => {
	const reading = androidMotionReading({ x: 0, y: 0, z: 1, timestamp: 4 }, { x: Math.PI, y: 0, z: 0, timestamp: 4 })!;
	assert.equal(reading.accelerationIncludingGravity.z, -9.80665);
	assert.equal(deviceRotationRate(reading.rotationRate!, "android").x, 180);
	assert.equal(reading.timestamp, 4);
	assert.equal(reading.acceleration, null);
});
test("Android rejects mismatched sensor times and nonfinite readings", () => {
	assert.equal(androidMotionReading({ x: 0, y: 0, z: 1, timestamp: 1 }, { x: 0, y: 0, z: 0, timestamp: 2 }), null);
	assert.equal(androidMotionReading({ x: NaN, y: 0, z: 1, timestamp: 1 }, { x: 0, y: 0, z: 0, timestamp: 1 }), null);
});
function sample(ms: number, gyro = { x: 0, y: 0, z: 0 }): MotionReading {
	return { timestamp: ms / 1000, rotation: { alpha: 0, beta: 0, gamma: 0 },
		rotationRate: { alpha: gyro.z, beta: gyro.y, gamma: gyro.x }, acceleration: { x: 0, y: 0, z: 0 },
		accelerationIncludingGravity: { x: -9.80665 * Math.SQRT1_2, y: 0, z: -9.80665 * Math.SQRT1_2 } };
}
test("browser top-level seconds calibrate even when JS callbacks arrive in a batch", () => {
	const model = new MotionController("gunner", "ios");
	for (let ms = 0; ms <= 500; ms += 20) model.process(sample(ms), 2000);
	assert.equal(model.getDebug().calibration, "ready");
	const turn = model.process(sample(520, { x: 40, y: 0, z: 40 }), 2000);
	assert.ok(Math.abs(turn.lookDX!) > 0.5 && Math.abs(turn.lookDX!) < 2);
});
test("sensor timestamp restart recovers instead of rejecting samples forever", () => {
	const model = new MotionController("movement", "android");
	for (let ms = 10000; ms <= 10500; ms += 20) model.process(sample(ms), ms);
	assert.equal(model.process(sample(0), 10600).ready, false);
	for (let ms = 20; ms <= 500; ms += 20) model.process(sample(ms), 10600 + ms);
	assert.equal(model.getDebug().calibration, "ready");
});
test("background sensor gap cannot create a camera jump", () => {
	const model = new MotionController("gunner", "ios");
	for (let ms = 0; ms <= 500; ms += 20) model.process(sample(ms), ms);
	const resumed = model.process(sample(5000, { x: 90, y: 90, z: 90 }), 5000);
	assert.equal(resumed.ready, false);
	assert.equal(resumed.lookDX, 0);
	assert.equal(resumed.sprint, false);
});
test("initial resting gyro bias is learned without removing intentional aiming", () => {
	const model = new MotionController("gunner", "ios");
	const bias = { x: 1.9, y: 0, z: 1.9 };
	for (let ms = 0; ms <= 600; ms += 20) model.process(sample(ms, bias), ms);
	assert.equal(model.process(sample(620, bias), 620).lookDX, 0);
	assert.ok(Math.abs(model.process(sample(640, { x: 40, y: 0, z: 40 }), 640).lookDX!) > 0.5);
});

test("raw Android sensors move and aim correctly in both landscape grips", () => {
	for (const grip of ["landscape-left", "landscape-right"] as const) {
		for (const role of ["movement", "gunner"] as const) {
			const rig = new PhoneRig(grip, "android"); rig.tremor = false;
			const model = new MotionController(role, "android");
			const pose = neutralPose();
			const step = () => {
				const { reading, gyro, gravity } = rig.step(pose, 20);
				const time = reading.rotationRate.timestamp;
				const normalized = androidMotionReading(
					{ x: -gravity[0] / 9.80665, y: -gravity[1] / 9.80665, z: -gravity[2] / 9.80665, timestamp: time },
					{ x: gyro[0] * Math.PI / 180, y: gyro[1] * Math.PI / 180, z: gyro[2] * Math.PI / 180, timestamp: time },
				)!;
				return model.process(normalized);
			};
			for (let i = 0; i < 30; i++) step();
			let forward = 0, right = 0;
			if (role === "movement") {
				for (let i = 0; i < 20; i++) { pose.fwd += 0.7; forward = step().moveY; }
				assert.ok(forward > 0.5, `${grip}: forward tilt must move forward`);
				for (let i = 0; i < 20; i++) { pose.right += 0.7; right = step().moveX; }
				assert.ok(right > 0.4, `${grip}: right tilt must strafe right`);
			} else {
				for (let i = 0; i < 25; i++) { pose.yaw -= 1.2; right += step().lookDX!; }
				assert.ok(Math.abs(right - 30) < 1, `${grip}: raw radians must turn camera 30 degrees, got ${right}`);
			}
		}
	}
});
