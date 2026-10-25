import assert from "node:assert/strict";
import { test } from "node:test";
import { gestureCue, lobbyCues } from "../src/lib/haptic-cues.ts";
import { idleLobby, type LobbyView } from "../src/service/lobby-client.ts";

const me = { controllerId: "p", name: "Ryan", teamId: 1, role: "movement", ready: false, connected: true } as const;
const lobby: LobbyView = { ...idleLobby, stage: "lobby", myId: "p", me: { ...me }, players: [{ ...me }], state: "waiting" };
const alive = { hp: 100, max_hp: 100, alive: true, weapon: 0, owned: [true, false, false], scoped: false, ammo: 12, magazine_size: 12, reloading: false, reload_progress: 0 };
const playing: LobbyView = { ...lobby, stage: "playing", state: "playing", feedback: alive };

test("runner gestures each have a haptic; nothing else does", () => {
	assert.equal(gestureCue("jump"), "jump");
	assert.equal(gestureCue("crouch"), "crouch");
	assert.equal(gestureCue("stand"), "crouch");
	assert.equal(gestureCue("sprint"), "sprint");
	assert.equal(gestureCue(null), null);
});

test("joining, picking a spot and readying up are confirmed", () => {
	assert.deepEqual(lobbyCues({ ...idleLobby, stage: "connecting" }, { ...lobby, me: { ...me, teamId: null, role: null } }), ["joined"]);
	assert.deepEqual(lobbyCues({ ...lobby, me: { ...me, teamId: null, role: null } }, lobby), ["select"]);
	assert.deepEqual(lobbyCues(lobby, { ...lobby, me: { ...me, ready: true } }), ["ready"]);
	assert.deepEqual(lobbyCues(lobby, lobby), [], "an unchanged lobby is silent");
	assert.deepEqual(lobbyCues({ ...idleLobby, stage: "connecting" }, { ...idleLobby, stage: "connecting", error: "That code doesn't match a lobby." }), ["failed"]);
});

test("kickoff, elimination, respawn, empty magazine and reload are felt", () => {
	assert.deepEqual(lobbyCues({ ...lobby, me: { ...me, ready: true } }, playing), ["kickoff"]);
	assert.deepEqual(lobbyCues(playing, { ...playing, feedback: { ...alive, hp: 0, alive: false } }), ["down"]);
	assert.deepEqual(lobbyCues({ ...playing, feedback: { ...alive, alive: false } }, playing), ["respawn"]);
	assert.deepEqual(lobbyCues({ ...playing, feedback: { ...alive, ammo: 1 } }, { ...playing, feedback: { ...alive, ammo: 0 } }), ["empty"]);
	assert.deepEqual(lobbyCues({ ...playing, feedback: { ...alive, ammo: 0, reloading: true } }, playing), ["reloaded"]);
	assert.deepEqual(lobbyCues(playing, { ...playing, feedback: { ...alive, hp: 60 } }), [], "damage comes from the game's buzz, not here");
});

test("the final whistle is a win, a loss or a draw for this phone's team", () => {
	const ended = (winningTeam: 1 | 2 | null) => ({ ...playing, stage: "ended" as const, state: "ended" as const, result: { winningTeam, scores: [1, 1] as [number, number], stats: [] } });
	assert.deepEqual(lobbyCues(playing, ended(1)), ["victory"]);
	assert.deepEqual(lobbyCues(playing, ended(2)), ["defeat"]);
	assert.deepEqual(lobbyCues(playing, ended(null)), ["draw"]);
});
