import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

type Message = Record<string, any>;

class Peer {
    readonly socket: WebSocket;
    private readonly events = new EventEmitter();
    private readonly messages: Message[] = [];

    constructor(url: string) {
        this.socket = new WebSocket(url);
        this.socket.on("message", (data) => {
            this.messages.push(JSON.parse(data.toString()));
            this.events.emit("message");
        });
    }

    async open() {
        await once(this.socket, "open");
        return this;
    }

    send(message: Message) {
        this.socket.send(JSON.stringify(message));
    }

    async next(type: string, matches: (message: Message) => boolean = () => true): Promise<Message> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        try {
            while (true) {
                const index = this.messages.findIndex((message) => message.type === type && matches(message));
                if (index >= 0) return this.messages.splice(index, 1)[0]!;
                await once(this.events, "message", { signal: controller.signal });
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    close() {
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
        else if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
    }
}

async function freePort() {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    assert(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    return port;
}

async function startRelay() {
    const port = await freePort();
    const child = spawn(process.execPath, [fileURLToPath(new URL("index.ts", import.meta.url))], {
        env: { ...process.env, PORT: String(port), MIN_CONTROLLERS: "4" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    let output = "";
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Relay did not start: ${output}`)), 8_000);
        child.stdout!.on("data", (chunk) => {
            output += String(chunk);
            if (output.includes("WebSocket server listening")) {
                clearTimeout(timeout);
                resolve();
            }
        });
        child.stderr!.on("data", (chunk) => { output += String(chunk); });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Relay exited ${code}: ${output}`)); });
    });
    return { child, url: `ws://127.0.0.1:${port}` };
}

const join = (pairingCode: string, name = "Tester") => ({ type: "join_game", protocolVersion: 1, pairingCode, name });
const controls = { moveX: 0.25, moveY: 0.5, lookX: 0, lookY: 0 };
const motion = { type: "motion", timestamp: Date.now(), payload: { controls } };

test("relay preserves authenticated lobby, match, reset and disconnect lifecycle", async () => {
    const { child, url } = await startRelay();
    const peers: Peer[] = [];
    const connect = async () => { const peer = new Peer(url); peers.push(peer); return peer.open(); };
    try {
        const host = await connect();
        host.send({ type: "hello", protocolVersion: 1, clientType: "game" });
        const registered = await host.next("game_registered");
        assert.match(registered.pairingCode, /^[A-HJKMNP-Z2-9]{6}$/);
        host.send({ type: "hello", protocolVersion: 1, clientType: "game" });
        assert.equal((await host.next("join_rejected")).code, "invalid_message");

        const phones: Peer[] = [];
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
            const phone = await connect();
            phones.push(phone);
            if (i === 0) {
                phone.send(join("WRONG!"));
                assert.equal((await phone.next("join_rejected")).code, "invalid_pairing_code");
            }
            phone.send(join(registered.pairingCode.toLowerCase(), `Tester ${i}`));
            ids.push((await phone.next("lobby_joined")).controllerId);
            if (i === 1) {
                phone.send({ type: "select_slot", teamId: 1, role: "movement" });
                assert.equal((await phone.next("join_rejected")).code, "slot_occupied");
            }
            phone.send({ type: "select_slot", teamId: i < 2 ? 1 : 2, role: i % 2 === 0 ? "movement" : "aim" });
            await phone.next("controller_assigned");
            phone.send({ type: "set_ready", ready: "true" });
            assert.equal((await phone.next("join_rejected")).code, "invalid_message");
            phone.send({ type: "set_ready", ready: true });
        }
        const ready = await host.next("lobby_state", (message) => message.state === "ready");
        assert.equal(ready.assignments.length, 4);
        host.send({ type: "start_game", protocolVersion: 1 });
        await host.next("broadcast", (message) => message.state === "playing");
        host.send({ type: "start_game", protocolVersion: 1 });
        assert.equal((await host.next("join_rejected")).code, "game_unavailable");

        phones[0]!.send({ ...motion, sender: ids[1] });
        assert.equal((await host.next("motion")).sender, ids[0], "server overwrites spoofed sender");
        phones[0]!.send({ type: "environment", timestamp: Date.now(), payload: { action: "shoot", pressed: true } });
        assert.equal((await phones[0]!.next("join_rejected")).code, "invalid_message");
        phones[0]!.send({ ...motion, payload: { controls: { ...controls, moveX: 2 } } });
        assert.equal((await phones[0]!.next("join_rejected")).code, "invalid_message");
        phones[0]!.send({ ...motion, timestamp: "bad" });
        assert.equal((await phones[0]!.next("join_rejected")).code, "invalid_message");
        phones[1]!.send({ type: "environment", timestamp: Date.now(), payload: { action: "reload", pressed: true } });
        assert.equal((await host.next("environment")).sender, ids[1]);
        host.send({ type: "to_controller", controllerId: ids[1], message: { t: "state", hp: 75, ammo: 8, magazine_size: 12 } });
        assert.equal((await phones[1]!.next("controller_feedback")).message.ammo, 8);
        phones[1]!.send({ type: "to_controller", controllerId: ids[0], message: { t: "state", hp: 0 } });
        assert.equal((await phones[1]!.next("join_rejected")).code, "invalid_message");

        phones[0]!.close();
        assert.equal((await host.next("controller_disconnected")).controllerId, ids[0]);
        const fewer = await host.next("lobby_state", (message) => message.assignments.length === 3 && message.state === "playing");
        assert.equal(fewer.state, "playing", "disconnect does not reset the live match");
        host.send({ type: "end_game", protocolVersion: 1, winningTeam: 1, scores: [10, 4], stats: [] });
        assert.deepEqual((await phones[1]!.next("match_ended")).scores, [10, 4]);
        host.send({ type: "reset_lobby", protocolVersion: 1 });
        const reset = await phones[1]!.next("lobby_state", (message) => message.state === "waiting" && message.players.length === 3 && message.players.every((player: Message) => player.ready === false));
        assert(reset.players.every((player: Message) => player.ready === false));
        const closed = once(phones[1]!.socket, "close");
        host.close();
        assert.equal((await closed)[0], 1001);
    } finally {
        for (const peer of peers) peer.close();
        child.kill();
    }
});

test("relay rejects binary and oversized packets", async () => {
    const { child, url } = await startRelay();
    const peers: Peer[] = [];
    try {
        const binary = await new Peer(url).open();
        peers.push(binary);
        const binaryClose = once(binary.socket, "close");
        binary.socket.send(Buffer.from("{}"));
        assert.equal((await binaryClose)[0], 1003);
        const oversized = await new Peer(url).open();
        peers.push(oversized);
        const oversizedClose = once(oversized.socket, "close");
        oversized.socket.send("x".repeat(65_537));
        assert.equal((await oversizedClose)[0], 1009);
    } finally {
        for (const peer of peers) peer.close();
        child.kill();
    }
});

test("embedded Godot server accepts real phones and completes play, feedback and replay", { skip: !process.env.GODOT_BIN }, async () => {
    const port = await freePort();
    const child = spawn(process.env.GODOT_BIN!, ["--headless", "--path", fileURLToPath(new URL("../game/", import.meta.url)), "--script", "tests/network_fixture.gd", "--", `--test-port=${port}`], {
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const peers: Peer[] = [];
    let output = "";
    try {
        const code = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Godot fixture did not start: ${output}`)), 12_000);
            child.stdout!.on("data", (chunk) => {
                output += String(chunk);
                const match = /NETWORK_FIXTURE (\{[^\r\n]+\})/.exec(output);
                if (match) {
                    clearTimeout(timeout);
                    resolve(JSON.parse(match[1]!).code);
                }
            });
            child.stderr!.on("data", (chunk) => { output += String(chunk); });
            child.once("error", (error) => { clearTimeout(timeout); reject(error); });
            child.once("exit", (status) => { clearTimeout(timeout); reject(new Error(`Godot fixture exited ${status}: ${output}`)); });
        });
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
            const phone = await new Peer(`ws://127.0.0.1:${port}`).open();
            peers.push(phone);
            if (i === 0) {
                phone.send({ ...join(code), protocolVersion: {} });
                assert.equal((await phone.next("join_rejected")).code, "invalid_message");
            }
            phone.send(join(code.toLowerCase(), `Godot ${i}`));
            ids.push((await phone.next("lobby_joined")).controllerId);
            phone.send({ type: "select_slot", teamId: i < 2 ? 1 : 2, role: i % 2 === 0 ? "movement" : "aim" });
            await phone.next("controller_assigned");
            phone.send({ type: "set_ready", ready: true });
        }
        await peers[0]!.next("broadcast", (message) => message.state === "playing");
        peers[0]!.send({ ...motion, sender: ids[1] });
        const feedback = (await peers[0]!.next("controller_feedback")).message;
        assert.equal(feedback.testSender, ids[0], "Godot overwrites spoofed controller identity");
        assert.equal(feedback.ammo, 8);
        peers[0]!.send({ ...motion, payload: { controls: { ...controls, moveX: 2 } } });
        assert.equal((await peers[0]!.next("join_rejected")).code, "invalid_message");
        peers[0]!.send({ type: "environment", timestamp: Date.now(), payload: { action: "shoot", pressed: true } });
        assert.equal((await peers[0]!.next("join_rejected")).code, "invalid_message");
        peers[1]!.send({ type: "environment", timestamp: Date.now(), payload: { action: "reload", pressed: true } });
        assert.deepEqual((await peers[0]!.next("match_ended")).scores, [10, 4]);
        const reset = await peers[0]!.next("lobby_state", (message) => message.state === "waiting" && message.players.length === 4 && message.players.every((player: Message) => player.ready === false));
        assert.equal(reset.assignments.length, 4);
        assert.match(output, /INPUT_ROUTER_TESTS passed/);
        assert(!/SCRIPT ERROR|Parse Error/.test(output), output);
    } catch (error) {
        throw new Error(`Embedded server integration failed. Godot output:\n${output}`, { cause: error });
    } finally {
        for (const peer of peers) peer.close();
        child.kill();
    }
});
