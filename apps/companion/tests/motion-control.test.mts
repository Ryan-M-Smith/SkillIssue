import assert from "node:assert/strict";
import { test } from "node:test";
import { PhoneRig } from "./phone-rig.ts";
import { MotionController } from "../src/service/motion-control-service";
import type { MotionReading, MotionVector, Role } from "../src/types/motion";

const gravity = { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 };
const zero = { x: 0, y: 0, z: 0 };

function sample(ms: number, down = gravity, acceleration = zero, gyro = zero): MotionReading {
	return {
		rotation: { alpha: 0, beta: 0, gamma: 0, timestamp: ms / 1000 },
		rotationRate: { alpha: gyro.z, beta: gyro.y, gamma: gyro.x, timestamp: ms / 1000 },
		acceleration,
		accelerationIncludingGravity: { x: down.x * 9.80665 + acceleration.x, y: down.y * 9.80665 + acceleration.y, z: down.z * 9.80665 + acceleration.z },
	};
}
function calibrated(role: Role) {
	const model = new MotionController(role, "ios");
	for (let ms = 0; ms <= 500; ms += 20) model.process(sample(ms), ms);
	return model;
}
function wheel(degrees: number): MotionVector {
	const a = degrees * Math.PI / 180;
	return { x: gravity.x * Math.cos(a), y: gravity.x * Math.sin(a), z: gravity.z };
}

test("calibrates a landscape grip in half a second", () => {
	const model = calibrated("movement");
	assert.equal(model.getDebug().calibration, "ready");
	assert.equal(model.getDebug().grip, "landscape");
});

test("a gentle 33 degree wheel twist toggles sprint without a speed threshold", () => {
	const model = calibrated("movement");
	const controls = model.process(sample(600, wheel(33)), 600);
	assert.equal(controls.action, "sprint");
	assert.equal(controls.sprint, true);
});

test("held twist and rebound cannot repeatedly toggle sprint", () => {
	const model = calibrated("movement");
	model.process(sample(600, wheel(33)), 600);
	for (let ms = 620; ms <= 1100; ms += 20) {
		const controls = model.process(sample(ms, wheel(ms < 1000 ? 35 : 18)), ms);
		assert.equal(controls.action, null);
		assert.equal(controls.sprint, true);
	}
	model.process(sample(1120), 1120);
	const controls = model.process(sample(1140, wheel(-33)), 1140);
	assert.equal(controls.action, "sprint");
	assert.equal(controls.sprint, false);
});

test("normal small tilts move promptly and stay below the sprint threshold", () => {
	const model = calibrated("movement");
	const controls = model.process(sample(600, wheel(15)), 600);
	assert.ok(Math.abs(controls.moveX) > 0.1);
	assert.equal(controls.sprint, false);
	assert.equal(controls.action, null);
});

test("gunner gestures no longer trigger anything: jab, lift, pull and twist only aim", () => {
	const lift = { x: -gravity.x * 5, y: 0, z: -gravity.z * 5 };
	for (const [linear, down] of [[{ x: 0, y: 0, z: -4 }, gravity], [{ x: 0, y: 0, z: 4 }, gravity], [lift, gravity], [zero, wheel(33)]] as const) {
		assert.equal(calibrated("gunner").process(sample(600, down, linear), 600).action, null);
	}
});

test("small gyro turns aim and tremor does not", () => {
	const model = calibrated("gunner");
	assert.equal(model.process(sample(600, gravity, zero, { x: 1, y: 0, z: 0 }), 600).lookX, 0);
	assert.notEqual(model.process(sample(620, gravity, zero, { x: 10, y: 0, z: 0 }), 620).lookX, 0);
});

test("turning the phone right looks right and tipping its back up looks up (not inverted)", () => {
	for (const platform of ["ios", "android"]) {
		for (const grip of ["landscape-left", "landscape-right"] as const) {
			const rig = new PhoneRig(grip, platform);
			rig.tremor = false;
			const model = new MotionController("gunner", platform);
			let now = 1000;
			const pose = { fwd: 0, right: 0, twist: 0, yaw: 0 };
			const step = () => { now += 20; return model.process(rig.step(pose, 20).reading as never, now); };
			for (let i = 0; i < 60; i++) step(); // calibrate
			let right = 0, up = 0;
			for (let i = 0; i < 20; i++) { pose.yaw -= 1.2; right += step().lookX; }  // yaw < 0: turning right
			for (let i = 0; i < 20; i++) step();
			for (let i = 0; i < 20; i++) { pose.fwd -= 1.2; up += step().lookY; }    // fwd < 0: back of the phone tips up
			assert.ok(right > 1, `${platform} ${grip}: turning right gave lookX ${right}`);
			assert.ok(up > 1, `${platform} ${grip}: tipping up gave lookY ${up}`);
		}
	}
});

test("jump and crouch remain one-shot actions and crouch ends sprint", () => {
	const jumper = calibrated("movement");
	const jumpActions = [];
	for (let ms = 600; ms <= 740; ms += 20) {
		const output = jumper.process(sample(ms, gravity, zero, { x: 0, y: -160, z: 0 }), ms);
		if (output.action) jumpActions.push(output.action);
	}
	assert.deepEqual(jumpActions, ["jump"]);
	const croucher = calibrated("movement");
	croucher.process(sample(600, wheel(33)), 600);
	croucher.process(sample(1000), 1000);
	let last;
	for (let ms = 1020; ms <= 1120; ms += 20) last = croucher.process(sample(ms, gravity, zero, { x: 0, y: 160, z: 0 }), ms);
	assert.equal(last?.crouch, true);
	assert.equal(last?.sprint, false);
});

test("reset clears sprint and starts a fresh calibration", () => {
	const model = calibrated("movement");
	model.process(sample(600, wheel(33)), 600);
	model.reset();
	const controls = model.process(sample(620), 620);
	assert.equal(controls.ready, false);
	assert.equal(controls.sprint, false);
	assert.equal(controls.moveX, 0);
});

test("invalid sensor numbers stop input instead of emitting NaN", () => {
	const model = calibrated("gunner");
	const controls = model.process(sample(600, { x: NaN, y: 0, z: 0 }), 600);
	assert.equal(controls.action, null);
	assert.equal(controls.lookX, 0);
	assert.equal(controls.moveX, 0);
});
