import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeTurn, gyroAim } from "../src/lib/math/gyro-aim.ts";

test("mouse aiming keeps slow corrections precise and makes wrist sweeps useful", () => {
	assert.equal(gyroAim(10, 0).x, 12.5, "slow turns: a little more than the phone");
	assert.ok(gyroAim(90, 0).x > 120 && gyroAim(90, 0).x < 160);
	assert.ok(gyroAim(300, 0).x >= 890, "quick snaps: about 3×, so turning around needs no spin");
	assert.deepEqual(gyroAim(0.5, -0.5), { x: 0, y: 0 });
	assert.ok(gyroAim(1.01, 0).x < 0.001, "no sudden jump at the noise threshold");
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

test("edge turning: only past 15°, smooth up to full speed, both ways", () => {
	assert.equal(edgeTurn(0), 0);
	assert.equal(edgeTurn(14), 0);
	assert.ok(edgeTurn(20) > 0 && edgeTurn(20) < 40);
	assert.equal(edgeTurn(40), 160);
	assert.equal(edgeTurn(70), 160);
	assert.equal(edgeTurn(-40), -160);
	assert.equal(edgeTurn(NaN), 0);
});
