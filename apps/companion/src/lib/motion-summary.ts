import type { Action, GameControls } from "@/types/motion";

export type Direction = {
	label: string;
	arrow: string;
};

const directions: Direction[] = [
	{ label: "Forward", arrow: "↑" },
	{ label: "Forward-right", arrow: "↗" },
	{ label: "Right", arrow: "→" },
	{ label: "Back-right", arrow: "↘" },
	{ label: "Back", arrow: "↓" },
	{ label: "Back-left", arrow: "↙" },
	{ label: "Left", arrow: "←" },
	{ label: "Forward-left", arrow: "↖" },
];

export const noDirection: Direction = { label: "None", arrow: "•" };

/** The 8-way direction the movement controls point in. */
export function directionOf(controls: Pick<GameControls, "moveX" | "moveY">): Direction {
	if (controls.moveX === 0 && controls.moveY === 0) {
		return noDirection;
	}

	// 0° = forward, clockwise
	const degrees = (Math.atan2(controls.moveX, controls.moveY) * 180) / Math.PI;
	const index = Math.round(((degrees + 360) % 360) / 45) % 8;
	return directions[index];
}

export type MovementState =
	| "Calibrating"
	| "Standing"
	| "Walking"
	| "Sprinting"
	| "Crouching"
	| "Crouch-walking"
	| "Jumping";

export type Counts = {
	jumps: number;
	crouches: number;
	standUps: number;
	sprints: number;
	movements: number;
};

export const zeroCounts: Counts = {
	jumps: 0,
	crouches: 0,
	standUps: 0,
	sprints: 0,
	movements: 0,
};

const jumpShowMs = 600;

/**
 * Turns the model's per-sample output into what the screens show:
 * running counts, the movement state and the direction.
 */
export class MotionTally {
	counts: Counts = { ...zeroCounts };
	private moving = false;
	private jumpedAt = -Infinity;

	reset() {
		this.counts = { ...zeroCounts };
		this.moving = false;
		this.jumpedAt = -Infinity;
	}

	/** Feed one output; `now` in ms. */
	add(controls: GameControls, now: number) {
		const action: Action = controls.action;

		if (action === "jump") {
			this.counts.jumps++;
			this.jumpedAt = now;
		} else if (action === "crouch" && controls.crouch) {
			this.counts.crouches++;
		} else if (action === "crouch" || action === "stand") {
			this.counts.standUps++;
		} else if (action === "sprint" && controls.sprint) {
			this.counts.sprints++;
		}

		const moving = controls.moveX !== 0 || controls.moveY !== 0;
		if (moving && !this.moving) {
			this.counts.movements++;
		}
		this.moving = moving;
	}

	state(controls: GameControls, now: number): MovementState {
		if (!controls.ready) return "Calibrating";
		if (now - this.jumpedAt < jumpShowMs) return "Jumping";
		const moving = controls.moveX !== 0 || controls.moveY !== 0;
		if (controls.crouch) return moving ? "Crouch-walking" : "Crouching";
		if (controls.sprint && controls.moveY > 0.1) return "Sprinting";
		return moving ? "Walking" : "Standing";
	}
}
