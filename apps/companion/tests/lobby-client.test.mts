import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LobbyClient } from "../src/service/lobby-client.ts";
import { normalizeLobbyCode } from "../src/lib/net/lobby-code.ts";
import { publicGameServer, resetPublicGameServer } from "../src/lib/net/relay.ts";

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

test("lobby codes are six letters or digits, any case, spaces ignored", () => {
	assert.equal(normalizeLobbyCode(" abc123 "), "ABC123");
	assert.equal(normalizeLobbyCode("abc-123"), "ABC123");
	for (const bad of ["", "ABC12", "ABC1234", "wss://host.example/ABC123", "ABC!23"]) assert.throws(() => normalizeLobbyCode(bad), /6-character code/);
});

test("the relay comes from EXPO_PUBLIC_GAME_SERVER, else the control plane", async () => {
	try {
		process.env.EXPO_PUBLIC_GAME_SERVER = "wss://configured.example.com";
		assert.equal(await publicGameServer(async () => { throw new Error("not called"); }), "wss://configured.example.com");
		delete process.env.EXPO_PUBLIC_GAME_SERVER;
		const asked: string[] = [];
		const fake = (async (url: string) => {
			asked.push(url);
			return new Response(JSON.stringify({ websocketUrl: "wss://relay.example.com", configured: true }));
		}) as unknown as typeof fetch;
		assert.equal(await publicGameServer(fake), "wss://relay.example.com");
		assert.deepEqual(asked, ["https://skillissue.vodka/api/connection"]);
		resetPublicGameServer();
		const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
		assert.equal(await publicGameServer(down), "");
	} finally {
		delete process.env.EXPO_PUBLIC_GAME_SERVER;
		resetPublicGameServer();
	}
});

test("join retries after timeout and permits a new attempt", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const client = new LobbyClient("ws://localhost:8080", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	assert.equal(client.snapshot.stage, "connecting");
	t.mock.timers.tick(10001);
	assert.equal(client.snapshot.stage, "connecting");
	assert.match(client.snapshot.error!, /Retrying/);
	t.mock.timers.tick(500);
	assert.equal(Socket.instances.length, 2);
	client.join("DEF456", "Tester");
	assert.equal(client.snapshot.stage, "connecting");
});
test("a first join that can't reach the server says so and stops after 3 tries", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const client = new LobbyClient("wss://relay.example.com", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	Socket.instances[0].close();
	assert.equal(client.snapshot.error, "Can't reach the game server (relay.example.com). Retrying…");
	t.mock.timers.tick(500);
	assert.equal(client.snapshot.error, "Can't reach the game server (relay.example.com). Retrying…", "the error stays visible while retrying");
	Socket.instances[1].close();
	t.mock.timers.tick(1000);
	Socket.instances[2].close();
	assert.equal(client.snapshot.stage, "closed");
	assert.equal(client.snapshot.error, "Can't reach the game server (relay.example.com). Check your internet connection, then try again.");
	t.mock.timers.tick(20000);
	assert.equal(Socket.instances.length, 3, "no more retries after giving up");
});
test("a server that accepts the socket but never answers the join is named", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const client = new LobbyClient("wss://relay.example.com", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	Socket.instances[0].onopen?.();
	t.mock.timers.tick(10001);
	assert.match(client.snapshot.error!, /Connected to relay\.example\.com, but it didn't answer the join/);
});
test("a server that answers with something else says what it sent", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const client = new LobbyClient("wss://relay.example.com", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	Socket.instances[0].onopen?.();
	Socket.instances[0].receive({ type: "hello_from_old_relay" });
	Socket.instances[0].onmessage?.({ data: "Bad Gateway" });
	t.mock.timers.tick(10001);
	assert.match(client.snapshot.error!, /relay\.example\.com answered with "hello_from_old_relay, not JSON" instead of joining/);
});
test("phones send the join even though React Native leaves bufferedAmount unset", () => {
	const client = new LobbyClient("wss://relay.example.com", "ios"); clients.push(client);
	client.join("ABC123", "Tester");
	const socket = Socket.instances[0] as unknown as { bufferedAmount?: number; onopen: () => void; sent: Record<string, unknown>[] };
	delete socket.bufferedAmount; // like React Native's WebSocket
	socket.onopen();
	assert.deepEqual(socket.sent[0], { type: "join_game", protocolVersion: 1, pairingCode: "ABC123", name: "Tester" });
});
test("obsolete socket messages and errors cannot replace a retried connection", () => {
	const { client, socket: old } = connect();
	client.join("DEF456", "Tester");
	old.receive({ type: "lobby_joined", controllerId: "old", pairingCode: "ABC123" });
	old.onerror?.();
	assert.equal(client.snapshot.code, "DEF456");
	assert.equal(client.snapshot.stage, "connecting");
});
test("malformed frames are ignored and connection errors schedule a retry", () => {
	const { client, socket } = connect();
	socket.receive(null);
	socket.onmessage?.({ data: "{" });
	assert.equal(client.snapshot.stage, "playing");
	socket.onerror?.();
	assert.equal(client.snapshot.stage, "connecting");
	assert.match(client.snapshot.error!, /Retrying/);
});
test("gunner buttons send fire, aim, reload and only owned weapons; gestures send nothing", () => {
	const { client, socket } = connect();
	socket.receive({ type: "controller_feedback", message: { t: "state", hp: 80, max_hp: 100, alive: true, weapon: 0, owned: [true, false, true], ammo: 5, magazine_size: 12 } });
	for (const action of ["shoot", "reload", "scope", "weapon_next"] as const) client.update({ ...controls, action }, reading);
	client.setFiring(true);
	client.setFiring(true); // still held: nothing new
	client.setFiring(false);
	client.toggleAim();
	client.reload();
	client.nextWeapon();
	const actions = socket.sent.filter((m) => m.type === "environment").map((m) => m.payload);
	assert.deepEqual(actions.map((a) => [a.action, a.pressed]), [["shoot", true], ["shoot", false], ["scope", true], ["reload", true], ["weapon", true]]);
	assert.equal(actions[4].slot, 2);
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
test("a held FIRE ends with the connection and never carries into the next one", () => {
	const { client } = connect();
	client.setFiring(true);
	client.join("DEF456", "Tester");
	const next = Socket.instances.at(-1)!;
	client.setFiring(false);
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

test("a socket that errors again while closing doesn't recurse", () => {
	const client = new LobbyClient("ws://localhost:8080", "ios");
	clients.push(client);
	client.join("ABC123", "Tester");
	const socket = Socket.instances.at(-1)!;
	let errors = 0;
	// Like browsers and Node: close() on a connecting socket fires error, then close.
	socket.close = () => { errors += 1; if (errors > 50) throw new Error("recursed"); socket.onerror?.(); socket.readyState = 3; socket.onclose?.(); };
	socket.onerror?.();
	assert.equal(errors, 1);
	assert.equal(client.snapshot.stage, "connecting");
});

test("motion goes out as soon as a sample arrives, at most about every 15 ms", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const { client, socket } = connect("movement");
	const motions = () => socket.sent.filter((m) => m.type === "motion");
	client.update(controls, reading as never);
	assert.equal(motions().length, 1, "sent right away, not on the next tick");
	assert.equal(motions()[0].payload.controls.moveY, 1);
	client.update({ ...controls, moveY: 0.2 }, reading as never);
	assert.equal(motions().length, 1, "a burst of samples is coalesced");
	t.mock.timers.tick(16);
	client.update({ ...controls, moveY: 0.3 }, reading as never);
	assert.equal(motions().length, 2);
	assert.equal(motions()[1].payload.controls.moveY, 0.3);
	assert.equal("lookDX" in motions()[1].payload.controls, false, "the runner sends no look deltas");
});

test("the gunner sends every degree it turned, summed between messages", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000 });
	const { client, socket } = connect("aim");
	const motions = () => socket.sent.filter((m) => m.type === "motion");
	client.update({ ...controls, lookDX: 1.5, lookDY: -0.5 }, reading as never);
	client.update({ ...controls, lookDX: 2, lookDY: 0.25 }, reading as never);
	client.update({ ...controls, lookDX: 3, lookDY: 0 }, reading as never);
	t.mock.timers.tick(16);
	client.update({ ...controls, lookDX: 4, lookDY: 1 }, reading as never);
	const sent = motions().map((m) => [m.payload.controls.lookDX, m.payload.controls.lookDY]);
	assert.deepEqual(sent, [[1.5, -0.5], [9, 1.25]], "nothing is dropped or counted twice");
	assert.equal(motions()[0].payload.controls.moveY, 0, "the gunner never moves");
});
