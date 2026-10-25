import assert from "node:assert/strict";
import { test } from "node:test";
import { PhoneRig, seeded, type Grip, type Pose } from "./phone-rig.ts";
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

// ---------------------------------------------------------------- Runner, on a simulated phone

type Run = { rig: PhoneRig; model: MotionController; pose: Pose; now: number; out: ReturnType<MotionController["process"]>; actions: string[] };

/** A Runner phone with hand tremor, calibrated by a natural hold. */
function runner(grip: Grip = "landscape-left", platform = "ios"): Run {
	const rig = new PhoneRig(grip, platform);
	rig.random = seeded(7);
	const run: Run = { rig, model: new MotionController("movement", platform), pose: { fwd: 0, right: 0, twist: 0, yaw: 0 }, now: 1000, out: null as never, actions: [] };
	hold(run, 600);
	assert.equal(run.out.ready, true, "calibrates within 0.6 s of a natural hold");
	return run;
}
function step(run: Run, ms = 16) {
	run.now += ms;
	run.out = run.model.process(run.rig.step(run.pose, ms).reading as never, run.now);
	if (run.out.action) run.actions.push(run.out.action);
	return run.out;
}
function hold(run: Run, ms: number) {
	for (let left = ms; left > 0; left -= 16) step(run);
}
/** Ease the pose to `to` over `ms`, sampling as a phone would. */
function move(run: Run, to: Partial<Pose>, ms: number, each?: (out: Run["out"]) => void) {
	const from = { ...run.pose };
	const steps = Math.max(1, Math.round(ms / 16));
	for (let i = 1; i <= steps; i++) {
		const k = 0.5 - Math.cos((Math.PI * i) / steps) / 2;
		for (const key of Object.keys(to) as (keyof Pose)[]) run.pose[key] = from[key] + ((to[key] ?? from[key]) - from[key]) * k;
		const out = step(run);
		each?.(out);
	}
}
const grips = [["landscape-left", "ios"], ["landscape-right", "ios"], ["landscape-left", "android"], ["landscape-right", "android"]] as const;

test("held tilts walk and strafe promptly, and stop promptly", () => {
	for (const [grip, platform] of grips) {
		const run = runner(grip, platform);
		move(run, { fwd: 14 }, 150);
		hold(run, 50);
		assert.ok(run.out.moveY > 0.5, `${grip} ${platform}: forward tilt walks (${run.out.moveY})`);
		move(run, { fwd: 0 }, 150);
		hold(run, 50);
		assert.equal(run.out.moveY, 0, `${grip} ${platform}: back at neutral stops`);
		move(run, { right: 20 }, 200);
		hold(run, 50);
		assert.ok(run.out.moveX > 0.9, `${grip} ${platform}: a 20° tip strafes right at full speed (${run.out.moveX})`);
		move(run, { right: -20 }, 400);
		hold(run, 50);
		assert.ok(run.out.moveX < -0.9, `${grip} ${platform}: and left`);
		assert.deepEqual(run.actions, [], `${grip} ${platform}: walking and strafing fire nothing`);
	}
});

test("a deep strafe never toggles sprint, a 30° twist does without strafing", () => {
	for (const [grip, platform] of grips) {
		const run = runner(grip, platform);
		move(run, { right: 28 }, 300);
		hold(run, 300);
		move(run, { right: 0 }, 300);
		assert.deepEqual(run.actions, [], `${grip} ${platform}: a 28° strafe is not a twist`);
		let strafe = 0;
		move(run, { twist: 34 }, 700, (out) => { strafe = Math.max(strafe, Math.abs(out.moveX)); });
		assert.deepEqual(run.actions, ["sprint"], `${grip} ${platform}: a gentle twist toggles sprint`);
		assert.equal(run.out.sprint, true);
		assert.ok(strafe < 0.35, `${grip} ${platform}: twisting barely strafes (${strafe})`);
		hold(run, 1000);
		move(run, { twist: 0 }, 400);
		assert.deepEqual(run.actions, ["sprint"], `${grip} ${platform}: holding and returning don't toggle again`);
		move(run, { twist: -34 }, 500);
		assert.equal(run.out.sprint, false, `${grip} ${platform}: the next twist turns sprint off`);
	}
});

test("twisting to sprint while walking keeps walking", () => {
	const run = runner();
	move(run, { fwd: 15 }, 200);
	hold(run, 100);
	let slowest = 1;
	move(run, { twist: 34 }, 500, (out) => { slowest = Math.min(slowest, out.moveY); });
	assert.equal(run.out.sprint, true);
	assert.ok(slowest > 0.4, `forward walking continues through the twist (${slowest})`);
});

test("quick flicks jump and crouch at the turn of the flick; a fast one-way tilt does not", () => {
	for (const [grip, platform] of grips) {
		const run = runner(grip, platform);
		const started = run.now;
		let firedAt = 0;
		move(run, { fwd: -16 }, 80, () => { if (run.actions.length && !firedAt) firedAt = run.now; });
		move(run, { fwd: 0 }, 110, () => { if (run.actions.length && !firedAt) firedAt = run.now; });
		assert.deepEqual(run.actions, ["jump"], `${grip} ${platform}: flick back jumps`);
		assert.ok(firedAt - started <= 130, `${grip} ${platform}: the jump fires ${firedAt - started} ms in`);
		hold(run, 400);
		move(run, { fwd: 16 }, 80);
		move(run, { fwd: 0 }, 110);
		hold(run, 400);
		assert.deepEqual(run.actions, ["jump", "crouch"], `${grip} ${platform}: flick forward crouches`);
		assert.equal(run.out.crouch, true);
		move(run, { fwd: 22 }, 110); // fast, then held: that's walking
		hold(run, 500);
		assert.deepEqual(run.actions, ["jump", "crouch"], `${grip} ${platform}: a fast one-way tilt is not a flick`);
		assert.ok(run.out.moveY > 0.9);
	}
});

test("flicks don't make the character walk", () => {
	const run = runner();
	let most = 0;
	move(run, { fwd: -16 }, 80, (out) => { most = Math.max(most, Math.abs(out.moveY)); });
	move(run, { fwd: 0 }, 110, (out) => { most = Math.max(most, Math.abs(out.moveY)); });
	hold(run, 200);
	assert.deepEqual(run.actions, ["jump"]);
	assert.ok(most < 0.2, `the flick's own tilt doesn't walk (${most})`);
});

test("never needs a manual recalibration: grip creep, gyro drift, long play", () => {
	const run = runner();
	run.rig.bias = [1.5, -1, 2]; // a typical uncalibrated gyroscope
	// The hands slowly sag 9° over a minute of standing still: no walking.
	for (let i = 0; i < 60; i++) {
		move(run, { fwd: (i + 1) * 0.15 }, 1000);
		assert.equal(run.out.moveY, 0, `creep at ${run.pose.fwd.toFixed(1)}° doesn't walk`);
	}
	// Two minutes of strafing, walking and twisting later, everything still works.
	for (let i = 0; i < 20; i++) {
		move(run, { right: i % 2 ? 18 : -18 }, 300);
		hold(run, 1500);
		move(run, { right: 0, fwd: run.pose.fwd + 14 }, 300);
		hold(run, 1500);
		move(run, { fwd: run.pose.fwd - 14 }, 300);
		hold(run, 2000);
	}
	assert.deepEqual(run.actions, [], "drift never fires a gesture on its own");
	assert.equal(run.out.moveX, 0);
	assert.equal(run.out.moveY, 0);
	move(run, { fwd: run.pose.fwd + 14 }, 200);
	hold(run, 50);
	assert.ok(run.out.moveY > 0.5, "walking still works");
	move(run, { fwd: run.pose.fwd - 14 }, 200);
	move(run, { twist: 34 }, 500);
	assert.deepEqual(run.actions, ["sprint"], "sprint twist still works");
	move(run, { twist: 0 }, 400);
	move(run, { twist: 34 }, 500);
	assert.deepEqual(run.actions, ["sprint", "sprint"], "and re-arms");
});

test("a new grip recalibrates by itself", () => {
	const run = runner();
	move(run, { fwd: -60 }, 400); // switch to holding it upright
	let recalibrated = false;
	for (let i = 0; i < 150; i++) if (!step(run).ready) recalibrated = true;
	assert.ok(recalibrated, "it notices the new pose");
	hold(run, 600);
	assert.equal(run.out.ready, true);
	assert.equal(run.out.moveY, 0, "the new pose is neutral, so it doesn't walk");
	move(run, { fwd: -46 }, 200);
	hold(run, 50);
	assert.ok(run.out.moveY > 0.5, "tilting from the new pose walks");
});

test("calibration never gets stuck waiting for perfectly still hands", () => {
	const rig = new PhoneRig();
	rig.random = seeded(3);
	rig.shake = { gyro: 45, gravity: 0.3 }; // shaky hands, a bus
	const model = new MotionController("movement", "ios");
	let now = 0;
	let readyAt = -1;
	for (; now < 3000 && readyAt < 0; now += 16) if (model.process(rig.step(neutral(), 16).reading as never, now).ready) readyAt = now;
	assert.ok(readyAt > 0 && readyAt <= 1800, `ready after ${readyAt} ms`);
});

function neutral(): Pose {
	return { fwd: 0, right: 0, twist: 0, yaw: 0 };
}

test("gunner look deltas turn the camera 1:1 with the phone", () => {
	for (const [grip, platform] of grips) {
		const rig = new PhoneRig(grip, platform);
		rig.tremor = false;
		const model = new MotionController("gunner", platform);
		let now = 0;
		const pose = neutral();
		for (let i = 0; i < 40; i++) model.process(rig.step(pose, 16).reading as never, (now += 16));
		let dx = 0, dy = 0;
		for (let i = 1; i <= 30; i++) {
			pose.yaw = -i; // 30° to the right in under half a second (60°/s+)
			const out = model.process(rig.step(pose, 16).reading as never, (now += 16));
			dx += out.lookDX ?? 0; dy += out.lookDY ?? 0;
		}
		assert.ok(Math.abs(dx - 30) < 3, `${grip} ${platform}: turned ${dx.toFixed(1)}° for 30°`);
		assert.ok(Math.abs(dy) < 2);
		// A flick faster than the old 130°/s cap still turns all the way.
		dx = 0;
		for (let i = 1; i <= 6; i++) {
			pose.yaw = -30 - i * 10; // 600°/s
			dx += model.process(rig.step(pose, 16).reading as never, (now += 16)).lookDX ?? 0;
		}
		assert.ok(Math.abs(dx - 60) < 6, `${grip} ${platform}: a fast flick turned ${dx.toFixed(1)}° for 60°`);
	}
});
