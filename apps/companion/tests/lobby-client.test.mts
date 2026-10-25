import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LobbyClient } from "../src/service/lobby-client.ts";
import { parseJoinTicket } from "../src/lib/net/join-ticket.ts";

class Socket {
	static OPEN = 1;
	static instances: Socket[] = [];
	readyState = 1;
	bufferedAmount = 0;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	sent: Record<string, any>[] = [];
	constructor(readonly url: string) { Socket.instances.push(this); }
	send(text: string) { this.sent.push(JSON.parse(text)); }
	close() { this.readyState = 3; this.onclose?.(); }
	receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const originalSocket = globalThis.WebSocket;
const clients: LobbyClient[] = [];
beforeEach(() => { Socket.instances = []; globalThis.WebSocket = Socket as unknown as typeof WebSocket; });
afterEach(() => { clients.splice(0).forEach((client) => client.leave()); globalThis.WebSocket = originalSocket; });
function connect(role: "aim" | "movement" = "aim") {
	const client = new LobbyClient("ws://localhost:8080", "ios");
	clients.push(client);
	client.join("ABC123", "Tester");
	const socket = Socket.instances.at(-1)!;
	socket.onopen?.();
	socket.receive({ type: "lobby_joined", controllerId: "phone", pairingCode: "ABC123" });
	socket.receive({ type: "lobby_state", state: "playing", minPlayers: 4, players: [{ controllerId: "phone", name: "Tester", role, teamId: 1, connected: true, ready: true }] });
	return { client, socket };
}
const controls = { ready: true, moveX: 0.5, moveY: 1, lookX: 0, lookY: 0, sprint: false, crouch: false, action: null } as const;
const reading = { rotation: { alpha: 0, beta: 0, gamma: 0 }, rotationRate: null, acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: -9.81 } };

test("join tickets resolve codes, LAN addresses, IPv6, secure and app links", () => {
	assert.deepEqual(parseJoinTicket(" abc123 ", "ws://localhost:8080"), { code: "ABC123", serverUrl: "ws://localhost:8080/" });
	assert.deepEqual(parseJoinTicket("192.168.1.25:8080/abc123"), { code: "ABC123", serverUrl: "ws://192.168.1.25:8080/" });
	assert.equal(parseJoinTicket("[::1]:8080/ABC123").serverUrl, "ws://[::1]:8080/");
	assert.equal(parseJoinTicket("https://host.example/ABC123").serverUrl, "wss://host.example/");
	assert.equal(parseJoinTicket("wss://host.example/game/ABC123").serverUrl, "wss://host.example/game");
	assert.equal(parseJoinTicket("wss://host.example/game?code=ABC123&region=us").serverUrl, "wss://host.example/game?region=us");
	assert.deepEqual(parseJoinTicket("skillissue://join?server=wss%3A%2F%2Fhost.example&code=abc123"), { code: "ABC123", serverUrl: "wss://host.example/" });
	assert.deepEqual(parseJoinTicket("https://controller.example/join?server=wss%3A%2F%2Fhost.example&code=abc123"), { code: "ABC123", serverUrl: "wss://host.example/" });
});
test("bad tickets fail with actionable errors before opening a socket", () => {
	assert.throws(() => parseJoinTicket("ABC123"), /full lobby ticket/);
	for (const ticket of ["bad", "javascript://host/ABC123", "ws://user:secret@host/ABC123", "host:8080/SHORT", "companion://join?code=ABC123&server=https://host"]) assert.throws(() => parseJoinTicket(ticket));
});
test("join times out, exits joining, and permits a new attempt", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const client = new LobbyClient("ws://localhost:8080", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	assert.equal(client.snapshot.stage, "connecting");
	t.mock.timers.tick(10001);
	assert.equal(client.snapshot.stage, "closed");
	assert.match(client.snapshot.error!, /in time/);
	client.join("DEF456", "Tester");
	assert.equal(client.snapshot.stage, "connecting");
});
test("obsolete socket messages and errors cannot replace a retried connection", () => {
	const { client, socket: old } = connect();
	client.join("DEF456", "Tester");
	old.receive({ type: "lobby_joined", controllerId: "old", pairingCode: "ABC123" });
	old.onerror?.();
	assert.equal(client.snapshot.code, "DEF456");
	assert.equal(client.snapshot.stage, "connecting");
});
test("malformed frames are ignored and connection errors leave joining immediately", () => {
	const { client, socket } = connect();
	socket.receive(null);
	socket.onmessage?.({ data: "{" });
	assert.equal(client.snapshot.stage, "playing");
	socket.onerror?.();
	assert.equal(client.snapshot.stage, "closed");
	assert.match(client.snapshot.error!, /same Wi-Fi/);
});
test("gunner gestures route reload, scope and only owned weapons", () => {
	const { client, socket } = connect();
	socket.receive({ type: "controller_feedback", message: { t: "state", hp: 80, max_hp: 100, alive: true, weapon: 0, owned: [true, false, true], ammo: 5, magazine_size: 12 } });
	client.update({ ...controls, action: "reload" }, reading);
	client.update({ ...controls, action: "scope" }, reading);
	client.update({ ...controls, action: "weapon_next" }, reading);
	const actions = socket.sent.filter((m) => m.type === "environment").map((m) => m.payload);
	assert.deepEqual(actions.map((a) => a.action), ["reload", "scope", "weapon"]);
	assert.equal(actions[2].slot, 2);
	assert.equal(client.snapshot.feedback?.ammo, 5);
});
test("host-ended results return cleanly to the menu state when the host closes", () => {
	for (const close of ["onclose", "onerror"] as const) {
		const { client, socket } = connect();
		socket.receive({ type: "match_ended", winningTeam: 1, scores: [4, 2], stats: [], reason: "host" });
		assert.equal(client.snapshot.stage, "ended");
		assert.equal(client.snapshot.result?.reason, "host");
		socket[close]?.();
		assert.equal(client.snapshot.stage, "idle");
		assert.equal(client.snapshot.error, null);
	}
});
test("a queued shot release cannot fire into the next connection", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const { client } = connect();
	client.update({ ...controls, action: "shoot" }, reading);
	client.join("DEF456", "Tester");
	const next = Socket.instances.at(-1)!;
	t.mock.timers.tick(200);
	assert.equal(next.sent.length, 0);
});
test("frozen sensors release held movement and send neutral intent", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const { client, socket } = connect("movement");
	client.update({ ...controls, sprint: true, crouch: true }, reading);
	t.mock.timers.tick(350);
	const last = socket.sent.filter((m) => m.type === "motion").at(-1)!;
	assert.equal(last.payload.controls.moveX, 0);
	assert.equal(last.payload.controls.moveY, 0);
	assert.ok(socket.sent.some((m) => m.payload?.action === "sprint" && m.payload.pressed === false));
	assert.ok(socket.sent.some((m) => m.payload?.action === "crouch" && m.payload.pressed === false));
});

test("malformed lobby players are filtered without breaking a valid assignment", () => {
	const { client, socket } = connect("movement");
	socket.receive({ type: "lobby_state", state: "playing", minPlayers: -50, players: [
		null, 1, {}, { controllerId: 7 }, { controllerId: "bad", teamId: 9, role: "aim" },
		{ controllerId: "phone", name: "A name that is much too long", teamId: 1, role: "movement", connected: true, ready: true },
	] });
	assert.equal(client.snapshot.players.length, 1);
	assert.equal(client.snapshot.me?.controllerId, "phone");
	assert.equal(client.snapshot.me?.name.length, 16);
	assert.equal(client.snapshot.minPlayers, 1);
	socket.receive({ type: "lobby_state", state: "unknown", minPlayers: 4, players: [] });
	assert.equal(client.snapshot.stage, "playing");
	assert.equal(client.snapshot.players.length, 1);
});

test("feedback clamps out-of-range numbers and rejects nonfinite values", () => {
	const { client, socket } = connect();
	socket.receive({ type: "controller_feedback", message: { t: "state", hp: 999, max_hp: -1, alive: true, weapon: 99, owned: [true, "yes", true], ammo: 50, magazine_size: 5.8, reload_progress: 9 } });
	assert.deepEqual(client.snapshot.feedback, { hp: 1, max_hp: 1, alive: true, weapon: 2, owned: [true, false, true], ammo: 5, magazine_size: 5, scoped: false, reloading: false, reload_progress: 1 });
	socket.onmessage?.({ data: '{"type":"controller_feedback","message":{"t":"state","hp":1e999,"max_hp":1e999,"ammo":1e999,"magazine_size":1e999,"reload_progress":1e999,"weapon":1e999}}' });
	assert.equal(client.snapshot.feedback?.hp, 0);
	assert.equal(client.snapshot.feedback?.max_hp, 100);
	assert.equal(client.snapshot.feedback?.weapon, 2);
	assert.equal(client.snapshot.feedback?.reload_progress, 0);
	assert.equal(client.snapshot.feedback?.ammo, 0);
});

test("lobby gestures are discarded at kickoff until a fresh motion reading arrives", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const client = new LobbyClient("ws://localhost:8080", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	const socket = Socket.instances.at(-1)!;
	socket.receive({ type: "lobby_joined", controllerId: "phone", pairingCode: "ABC123" });
	const players = [{ controllerId: "phone", name: "Tester", role: "movement", teamId: 1, connected: true, ready: true }];
	socket.receive({ type: "lobby_state", state: "waiting", minPlayers: 4, players });
	client.update({ ...controls, sprint: true, crouch: true }, reading);
	socket.receive({ type: "lobby_state", state: "playing", minPlayers: 4, players });
	t.mock.timers.tick(60);
	assert.equal(socket.sent.filter(m => m.type === "motion" || m.type === "environment").length, 0);
	client.update(controls, reading);
	t.mock.timers.tick(40);
	assert.equal(socket.sent.filter(m => m.type === "motion").at(-1)?.payload.controls.moveY, 1);
});

test("pause keeps the match HUD and feedback while suppressing motion until resume", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const { client, socket } = connect("movement");
	socket.receive({ type: "controller_feedback", message: { t: "state", hp: 80, max_hp: 100, alive: true } });
	socket.receive({ type: "broadcast", state: "paused" });
	assert.equal(client.snapshot.stage, "playing");
	assert.equal(client.snapshot.state, "paused");
	assert.equal(client.snapshot.feedback?.hp, 80);
	client.update({ ...controls, sprint: true }, reading);
	t.mock.timers.tick(100);
	assert.equal(socket.sent.filter(m => m.type === "motion" || m.type === "environment").length, 0);
	socket.receive({ type: "broadcast", state: "playing" });
	t.mock.timers.tick(40);
	assert.equal(socket.sent.filter(m => m.type === "motion").length, 0);
	client.update(controls, reading);
	t.mock.timers.tick(40);
	assert.equal(socket.sent.filter(m => m.type === "motion").length > 0, true);
});
