import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { joinFirstAvailable, publicGameServer, resetPublicGameServer } from "../src/lib/net/find-lobby.ts";
import type { LobbyView } from "../src/service/lobby-client.ts";

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
	/** The server accepts the join. */
	accept() { this.onopen?.(); this.receive({ type: "lobby_joined", controllerId: "phone", pairingCode: "ABC123" }); }
	/** The server doesn't know this code. */
	reject() { this.onopen?.(); this.receive({ type: "join_rejected", code: "invalid_pairing_code", message: "That code doesn't match an open lobby. Check the code on the game screen." }); }
	/** Nothing listens there. */
	unreachable() { this.close(); }
}

const relay = "wss://relay.example.com/";
const lan = "ws://192.168.1.20:8080/";
const originalSocket = globalThis.WebSocket;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
let stops: (() => void)[] = [];
beforeEach(() => { Socket.instances = []; globalThis.WebSocket = Socket as unknown as typeof WebSocket; });
afterEach(() => { stops.splice(0).forEach((stop) => stop()); globalThis.WebSocket = originalSocket; resetPublicGameServer(); delete process.env.EXPO_PUBLIC_GAME_SERVER; });

function search(servers: string[]) {
	const views: LobbyView[] = [];
	const used: string[] = [];
	let client: { leave(): void } | null = null;
	const cancel = joinFirstAvailable(servers, "ABC123", "Tester", "ios", (c, url) => { client = c; used.push(url); }, (v) => views.push(v));
	stops.push(() => { cancel(); client?.leave(); });
	return { views, used, last: () => views.at(-1)! };
}

test("a code on the relay joins there and never touches the LAN", async () => {
	const s = search([relay, lan]);
	Socket.instances[0].accept();
	assert.deepEqual(s.used, [relay]);
	assert.equal(s.last().stage, "lobby");
	assert.equal(Socket.instances.length, 1);
});

test("a code the relay doesn't know is tried on the game computer (LAN)", async () => {
	const s = search([relay, lan]);
	Socket.instances[0].reject();
	await tick();
	assert.deepEqual(s.used, [relay, lan]);
	assert.equal(Socket.instances[1].url, lan);
	Socket.instances[1].accept();
	assert.equal(s.last().stage, "lobby");
	assert.equal(s.last().myId, "phone");
});

test("an unreachable relay falls through to the LAN", async () => {
	const s = search([relay, lan]);
	Socket.instances[0].unreachable();
	await tick();
	assert.deepEqual(s.used, [relay, lan]);
	Socket.instances[1].accept();
	assert.equal(s.last().stage, "lobby");
});

test("a wrong code says so instead of retrying an unreachable LAN forever", async () => {
	const s = search([relay, lan]);
	Socket.instances[0].reject();
	await tick();
	Socket.instances[1].unreachable();
	await tick();
	assert.equal(s.last().stage, "closed");
	assert.match(s.last().error ?? "", /doesn't match an open lobby/);
	assert.equal(Socket.instances.length, 2);
	await new Promise((r) => setTimeout(r, 700));
	assert.equal(Socket.instances.length, 2, "an abandoned server must not be retried");
});

test("once joined, a dropped connection keeps the same server (normal reconnect)", async () => {
	const s = search([relay, lan]);
	Socket.instances[0].accept();
	Socket.instances[0].unreachable();
	await tick();
	assert.deepEqual(s.used, [relay]);
	assert.equal(s.last().stage, "connecting");
});

test("the relay comes from EXPO_PUBLIC_GAME_SERVER, else the control plane", async () => {
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
});
