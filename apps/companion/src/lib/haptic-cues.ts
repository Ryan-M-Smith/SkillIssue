import type { LobbyView } from "@/service/lobby-client";
import type { Action } from "@/types/motion";

/**
 * Moments the phone confirms with a haptic. Which cue fits what is decided here, without
 * touching the device, so it can be tested; lib/haptics.ts plays them.
 *
 *   tap / select   buttons and picks          fire       FIRE pressed
 *   jump           flick back                 crouch     flick forward (crouch / stand)
 *   sprint         wheel twist                calibrated sensors found neutral
 *   hit            the team took damage       down       eliminated
 *   respawn        back in the fight          empty      magazine ran dry
 *   reloaded       reload finished            ready      Ready confirmed
 *   joined         in the lobby               failed     a join or lobby error
 *   kickoff        the match started          victory / defeat / draw   final whistle
 */
export type Cue =
	| "tap" | "select" | "fire" | "jump" | "crouch" | "sprint" | "calibrated"
	| "hit" | "down" | "respawn" | "empty" | "reloaded"
	| "ready" | "joined" | "failed" | "kickoff" | "victory" | "defeat" | "draw";

/** The haptic for a Runner gesture the motion model just recognised. */
export function gestureCue(action: Action): Cue | null {
	switch (action) {
		case "jump": return "jump";
		case "crouch":
		case "stand": return "crouch";
		case "sprint": return "sprint";
		default: return null;
	}
}

/** Haptics for what changed between two lobby views (the phone's own team and slot). */
export function lobbyCues(prev: LobbyView, next: LobbyView): Cue[] {
	const cues: Cue[] = [];
	if (prev.stage === "connecting" && next.stage === "lobby") cues.push("joined");
	if (next.error && next.error !== prev.error) cues.push("failed");
	const slot = (v: LobbyView) => (v.me?.teamId && v.me.role ? `${v.me.teamId}:${v.me.role}` : "");
	if (next.stage === "lobby" && slot(next) && slot(next) !== slot(prev)) cues.push("select");
	if (next.stage === "lobby" && !prev.me?.ready && next.me?.ready) cues.push("ready");
	if (prev.stage !== "playing" && next.stage === "playing") cues.push("kickoff");

	const was = prev.feedback;
	const now = next.feedback;
	if (next.stage === "playing" && was && now) {
		if (was.alive && !now.alive) cues.push("down");
		else if (!was.alive && now.alive) cues.push("respawn");
		if (now.alive && now.magazine_size > 0 && was.ammo > 0 && now.ammo === 0) cues.push("empty");
		if (now.alive && was.reloading && !now.reloading && now.ammo > 0) cues.push("reloaded");
	}

	if (prev.stage !== "ended" && next.stage === "ended" && next.result) {
		const winner = next.result.winningTeam;
		cues.push(winner === null || winner === undefined ? "draw" : winner === next.me?.teamId ? "victory" : "defeat");
	}
	return cues;
}
