import assert from "node:assert/strict";
import { test } from "node:test";
import { aimFromTilt } from "../src/lib/math/tilt-aim.ts";

test("small tilt moves aim slowly; larger tilt keeps a consistent turn direction", () => {
	assert.equal(aimFromTilt(1, 0).x, 0);
	assert.ok(aimFromTilt(2, 0).x > 0, "a small deliberate tilt moves the view");
	assert.ok(aimFromTilt(8, 0).x > aimFromTilt(2, 0).x);
	assert.ok(aimFromTilt(-8, 0).x < 0);
	assert.ok(aimFromTilt(0, 8).y > 0);
	assert.ok(aimFromTilt(0, -8).y < 0);
});

test("horizontal, vertical and diagonal tilts share one response", () => {
	for (const speed of [3, 8, 20, 35]) {
		const horizontal = aimFromTilt(speed, 0);
		const vertical = aimFromTilt(0, speed);
		const diagonal = aimFromTilt(speed * 0.6, speed * 0.8);
		assert.equal(horizontal.x, vertical.y);
		assert.ok(Math.abs(diagonal.x / diagonal.y - 0.75) < 1e-12);
		assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - horizontal.x) < 1e-10);
		assert.equal(aimFromTilt(-speed, 0).x, -horizontal.x);
	}
});

test("neutral and invalid tilt stop aiming", () => {
	assert.deepEqual(aimFromTilt(0, 0), { x: 0, y: 0 });
	for (const invalid of [NaN, Infinity, -Infinity]) assert.deepEqual(aimFromTilt(invalid, 0), { x: 0, y: 0 });
});
