import assert from "node:assert/strict";
import { test } from "node:test";
import { gyroAim } from "../src/lib/math/gyro-aim.ts";

test("mouse aiming keeps slow corrections precise and makes wrist sweeps useful", () => {
	assert.equal(gyroAim(10, 0).x, 10);
	assert.ok(gyroAim(90, 0).x > 90 && gyroAim(90, 0).x < 140);
	assert.ok(gyroAim(0.5, -0.5).x > 0 && gyroAim(0.5, -0.5).y < 0);
	assert.ok(gyroAim(0.4, 0).x > 0, "slow intentional movement is not suppressed");
	assert.equal(gyroAim(0.1, 0).x, 0, "resting noise remains suppressed");
});

test("horizontal, vertical and diagonal aiming share one sensitivity curve", () => {
	for (const speed of [5, 20, 60, 90, 180]) {
		const horizontal = gyroAim(speed, 0);
		const vertical = gyroAim(0, speed);
		const diagonal = gyroAim(speed * 0.6, speed * 0.8);
		assert.equal(horizontal.x, vertical.y);
		assert.ok(Math.abs(diagonal.x / diagonal.y - 0.75) < 1e-12);
		assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - horizontal.x) < 1e-10);
		assert.equal(gyroAim(-speed, 0).x, -horizontal.x);
	}
});

test("aiming stops and reverses immediately without phone-side filter history", () => {
	gyroAim(180, 30);
	assert.deepEqual(gyroAim(0, 0), { x: 0, y: 0 });
	assert.ok(gyroAim(-10, 0).x < 0);
	for (const invalid of [NaN, Infinity, -Infinity]) assert.deepEqual(gyroAim(invalid, 0), { x: 0, y: 0 });
});
