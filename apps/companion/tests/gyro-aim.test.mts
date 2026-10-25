import assert from "node:assert/strict";
import { test } from "node:test";
import { gyroAim } from "../src/lib/math/gyro-aim.ts";

test("the camera turns exactly as fast as the phone, slow or fast", () => {
	for (const speed of [1, 10, 90, 400]) {
		assert.equal(gyroAim(speed, 0).x, speed);
		assert.equal(gyroAim(0, -speed).y, -speed);
	}
	assert.ok(gyroAim(0.5, -0.5).x > 0 && gyroAim(0.5, -0.5).y < 0, "slow corrections still move");
	assert.equal(gyroAim(0.1, 0).x, 0, "resting noise is removed");
});

test("diagonals keep their direction, and stopping stops at once", () => {
	const d = gyroAim(30, 40);
	assert.ok(Math.abs(d.x / d.y - 0.75) < 1e-12);
	assert.deepEqual(gyroAim(0, 0), { x: 0, y: 0 });
	for (const invalid of [NaN, Infinity, -Infinity]) assert.deepEqual(gyroAim(invalid, 0), { x: 0, y: 0 });
});
