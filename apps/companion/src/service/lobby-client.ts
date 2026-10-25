import type {
	ControllerRole, EnvironmentAction, GameState, LobbyPlayer, MatchEndedMessage,
	MatchStatusMessage, MotionReading as ProtocolMotionReading, ServerMessage, TeamId,
} from "../../../../packages/protocol/events";
import type { GameControls, MotionReading } from "@/types/motion";
import { deviceRotationRate } from "@/lib/math/motion";

export type { ControllerRole, LobbyPlayer, TeamId } from "../../../../packages/protocol/events";
export type LobbyStage = "idle" | "connecting" | "lobby" | "playing" | "ended" | "closed";
export type ControllerFeedback = {
	hp: number; max_hp: number; alive: boolean; weapon: number; owned: boolean[];
	scoped: boolean; ammo: number; magazine_size: number; reloading: boolean; reload_progress: number;
};
export type LobbyView = {
	stage: LobbyStage;
	error: string | null;
	code: string;
	myId: string | null;
	me: LobbyPlayer | null;
	players: LobbyPlayer[];
	state: GameState | null;
	minPlayers: number;
	status: Omit<MatchStatusMessage, "type"> | null;
	result: Omit<MatchEndedMessage, "type"> | null;
	feedback: ControllerFeedback | null;
};

export const idleLobby: LobbyView = {
	stage: "idle", error: null, code: "", myId: null, me: null, players: [], state: null,
	minPlayers: 4, status: null, result: null, feedback: null,
};

/**
 * Motion goes out as soon as a new sensor sample is processed, at most every
 * `motionMinGapMs` (~60 Hz), so there is no wait for a fixed send tick. The interval
 * timer is only a heartbeat that keeps the game's input fresh when sensors pause.
 */
const motionMinGapMs = 15;
const heartbeatHz = 20;
const reconnectDelaysMs = [500, 1000, 2000, 4000, 8000];
/** Tries before a first join gives up (a lobby we were in keeps retrying). */
const firstJoinAttempts = 3;

/** The `type` of a message, for diagnostics ("not JSON" when it isn't one). */
function messageType(text: string): string {
	try {
		const value = JSON.parse(text);
		return typeof value?.type === "string" ? value.type.slice(0, 40) : "no type";
	} catch {
		return "not JSON";
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
}
const zero = { x: 0, y: 0, z: 0 };
const degToRad = Math.PI / 180;
const gameStates = new Set<GameState>(["waiting", "ready", "playing", "paused", "ended"]);
function bounded(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function lobbyPlayer(value: unknown): LobbyPlayer | null {
	if (!value || typeof value !== "object") return null;
	const p = value as Record<string, unknown>;
	if (typeof p.controllerId !== "string" || !p.controllerId || p.controllerId.length > 128) return null;
	if (p.teamId !== null && p.teamId !== 1 && p.teamId !== 2) return null;
	if (p.role !== null && p.role !== "aim" && p.role !== "movement") return null;
	return { controllerId: p.controllerId, name: typeof p.name === "string" ? p.name.slice(0, 16) : "Player",
		teamId: p.teamId, role: p.role, ready: p.ready === true, connected: p.connected === true };
}

/** One connection, with bounded joining and no callbacks surviving leave/retry. */
export class LobbyClient {
	private socket: WebSocket | null = null;
	private view: LobbyView = { ...idleLobby };
	private timer: ReturnType<typeof setInterval> | null = null;
	private joinTimer: ReturnType<typeof setTimeout> | null = null;
	/** Gunner is holding FIRE (sent as shoot pressed; released on lift-off). */
	private firing = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempt = 0;
	/** Got lobby_joined at least once since join() was called (reconnects keep it). */
	private joinedOnce = false;
	private reconnecting = false;
	private wanted = false;
	private joinCode = "";
	private joinName = "";
	private desiredSlot: { teamId: TeamId; role: ControllerRole } | null = null;
	private desiredReady = false;
	private latest: GameControls | null = null;
	private latestReading: MotionReading | null = null;
	private latestAt = 0;
	private lastMotionAt = 0;
	/** Gunner: degrees turned since the last motion message, sent so the game turns 1:1. */
	private lookDX = 0;
	private lookDY = 0;
	private sentCrouch = false;
	private sentSprint = false;
	private weapon = 0;

	constructor(
		private readonly url: string,
		private readonly platform: string,
		private readonly onChange: (view: LobbyView) => void = () => {},
	) {}

	get snapshot(): LobbyView { return this.view; }

	join(code: string, name: string) {
		const wasReconnect = this.reconnecting;
		const lastError = this.view.error;
		this.reconnecting = false;
		this.leave();
		this.wanted = true;
		if (!wasReconnect) {
			this.reconnectAttempt = 0;
			this.joinedOnce = false;
			this.desiredSlot = null;
			this.desiredReady = false;
		}
		this.joinCode = code.trim().toUpperCase();
		this.joinName = name.trim().slice(0, 16) || "Player";
		// Keep the last failure on screen while retrying, so it doesn't look like plain "joining".
		this.set({ ...idleLobby, stage: "connecting", code: this.joinCode, error: wasReconnect ? lastError : null });
		let socket: WebSocket;
		try { socket = new WebSocket(this.url); }
		catch { this.fail("Invalid host address. Paste the full lobby ticket from the game screen."); return; }
		this.socket = socket;
		// The connection is gone (closed, failed, or timed out): retry, unless the host ended it.
		// Called from every path, since not every runtime fires close after an error.
		let opened = false;
		const heard: string[] = []; // message types this socket got before joining

		const dropped = () => {
			if (this.socket !== socket) return;
			if (this.view.stage === "ended" && this.view.result?.reason === "host") { this.leave(); return; }
			this.socket = null;
			if (!this.joinedOnce) {
				const host = hostOf(this.url);
				this.scheduleReconnect(!opened
					? `Can't reach the game server (${host}). Retrying…`
					: heard.length
						? `${host} answered with "${[...new Set(heard)].slice(0, 3).join(", ")}" instead of joining. Retrying…`
						: `Connected to ${host}, but it didn't answer the join. Retrying…`);
				return;
			}
			this.scheduleReconnect(this.view.error ?? "Connection lost. Retrying...");
		};
		this.joinTimer = setTimeout(() => {
			if (this.socket === socket && this.view.stage === "connecting") {
				socket.close();
				dropped();
			}
		}, 10000);
		socket.onopen = () => {
			opened = true;
			if (this.socket === socket) this.send({ type: "join_game", protocolVersion: 1, pairingCode: code.trim().toUpperCase(), name: name.trim().slice(0, 16) || "Player" });
		};
		socket.onmessage = (event) => {
			if (this.socket !== socket) return;
			if (!this.joinedOnce && heard.length < 10) heard.push(messageType(String(event.data)));
			this.receive(String(event.data));
		};
		let closing = false;
		socket.onerror = () => {
			// Closing a socket that's still connecting fires another error on web and Node;
			// close once, or the handlers recurse until the stack overflows.
			if (closing) return;
			closing = true;
			if (this.socket === socket) socket.close();
			dropped();
		};
		socket.onclose = dropped;
		this.timer = setInterval(() => this.sendMotion(), 1000 / heartbeatHz);
	}

	leave() {
		this.wanted = false;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.stop();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.set({ ...idleLobby });
	}

	selectSlot(teamId: TeamId, role: ControllerRole) {
		this.desiredSlot = { teamId, role };
		this.desiredReady = false;
		this.send({ type: "select_slot", teamId, role });
	}
	setReady(ready: boolean) {
		this.desiredReady = ready;
		this.send({ type: "set_ready", ready });
	}

	update(controls: GameControls, reading: MotionReading) {
		this.latest = controls;
		this.latestReading = reading;
		this.latestAt = Date.now();
		if (this.view.stage !== "playing" || this.view.state === "paused" || !controls.ready) return;
		if (this.view.me?.role === "movement") {
			if (controls.action === "jump") this.sendAction("jump", true);
			this.syncHeld(controls);
		} else {
			// The gunner's phone only aims (sendMotion); its actions are buttons, below.
			this.lookDX += controls.lookDX ?? 0;
			this.lookDY += controls.lookDY ?? 0;
		}
		if (Date.now() - this.lastMotionAt >= motionMinGapMs) this.sendMotion();
	}

	/** Gunner can act: in a running match, holding the aim role. */
	private gunnerLive() {
		return this.view.stage === "playing" && this.view.state !== "paused" && this.view.me?.role === "aim";
	}

	/** Gunner: FIRE held down (true) or released (false). */
	setFiring(down: boolean) {
		if (down === this.firing || (down && !this.gunnerLive())) return;
		this.firing = down;
		this.sendAction("shoot", down);
	}

	/** Gunner: AIM button (toggles aiming down sights / the sniper scope). */
	toggleAim() {
		if (this.gunnerLive()) this.sendAction("scope", true);
	}

	/** Gunner: RELOAD button. */
	reload() {
		if (this.gunnerLive()) this.sendAction("reload", true);
	}

	/** Gunner: SWITCH button: the next gun this duo owns. */
	nextWeapon() {
		if (!this.gunnerLive()) return;
		const owned = this.view.feedback?.owned ?? [true, false, false];
		for (let step = 1; step <= owned.length; step++) {
			const slot = (this.weapon + step) % owned.length;
			if (owned[slot]) { this.selectWeapon(slot); break; }
		}
	}

	selectWeapon(slot: number) {
		if (!Number.isInteger(slot) || slot < 0 || slot > 2 || this.view.stage !== "playing" || this.view.me?.role !== "aim") return;
		this.weapon = slot;
		this.send({ type: "environment", timestamp: Date.now(), payload: { action: "weapon", pressed: true, slot } });
	}

	private syncHeld(controls: GameControls) {
		if (controls.crouch !== this.sentCrouch) { this.sentCrouch = controls.crouch; this.sendAction("crouch", controls.crouch); }
		if (controls.sprint !== this.sentSprint) { this.sentSprint = controls.sprint; this.sendAction("sprint", controls.sprint); }
	}

	private sendAction(action: EnvironmentAction, pressed: boolean) {
		this.send({ type: "environment", timestamp: Date.now(), payload: { action, pressed } });
	}

	private sendMotion() {
		if (this.view.stage !== "playing" || this.view.state === "paused" || !this.latest || !this.view.me?.role) return;
		const c = this.latest;
		const fresh = c.ready && Date.now() - this.latestAt < 300;
		if (!fresh) this.syncHeld({ ...c, crouch: false, sprint: false });
		const reading = this.latestReading;
		const gyro = reading?.rotationRate ? deviceRotationRate(reading.rotationRate, this.platform) : zero;
		const g = reading?.accelerationIncludingGravity ?? zero;
		const movement = this.view.me.role === "movement";
		const payload: ProtocolMotionReading = {
			accelerometer: { x: g.x, y: g.y, z: g.z },
			gyroscope: { x: gyro.x * degToRad, y: gyro.y * degToRad, z: gyro.z * degToRad },
			arPosition: zero, arOrientation: zero, trackingStatus: "unavailable",
			controls: { moveX: movement && fresh ? c.moveX : 0, moveY: movement && fresh ? c.moveY : 0,
				lookX: !movement && fresh ? c.lookX : 0, lookY: !movement && fresh ? c.lookY : 0,
				...(movement ? {} : { lookDX: fresh ? this.lookDX : 0, lookDY: fresh ? this.lookDY : 0 }) },
		};
		this.lookDX = 0;
		this.lookDY = 0;
		this.lastMotionAt = Date.now();
		this.send({ type: "motion", timestamp: this.lastMotionAt, payload });
	}

	private receive(text: string) {
		if (text.length > 65536) return;
		let message: ServerMessage;
		try { message = JSON.parse(text); } catch { return; }
		if (!message || typeof message !== "object") return;
		switch (message.type) {
			case "lobby_joined":
				this.joinedOnce = true;
				this.clearJoinTimer();
				this.reconnectAttempt = 0;
				this.set({ ...this.view, stage: "lobby", myId: message.controllerId, code: message.pairingCode, error: null });
				if (this.desiredSlot) {
					this.send({ type: "select_slot", ...this.desiredSlot });
					if (this.desiredReady) this.send({ type: "set_ready", ready: true });
				}
				return;
			case "lobby_state": {
				if (!Array.isArray(message.players)) return;
				const players = message.players.slice(0, 64).map(lobbyPlayer).filter((p): p is LobbyPlayer => p !== null);
				const me = players.find((p) => p.controllerId === this.view.myId) ?? null;
				this.setGameState(message.state, { players, me, minPlayers: Math.floor(bounded(message.minPlayers, 4, 1, 4)) });
				return;
			}
			case "broadcast":
				if (message.state) this.setGameState(message.state, {});
				if (message.error && this.view.stage !== "playing") this.set({ ...this.view, error: message.error });
				return;
			case "match_status":
				this.set({ ...this.view, status: { scores: message.scores, timeLeft: message.timeLeft, killTarget: message.killTarget } });
				return;
			case "match_ended":
				this.set({ ...this.view, stage: "ended", result: { winningTeam: message.winningTeam, scores: message.scores, stats: message.stats, reason: message.reason } });
				return;
			case "controller_feedback": {
				const f = message.message;
				if (!f || f.t !== "state") return;
				const maxHp = bounded(f.max_hp, 100, 1, 10000);
				const magazineSize = Math.floor(bounded(f.magazine_size, 0, 0, 1000));
				this.weapon = Math.floor(bounded(f.weapon, this.weapon, 0, 2));
				this.set({ ...this.view, feedback: {
					hp: bounded(f.hp, 0, 0, maxHp), max_hp: maxHp, alive: f.alive === true, weapon: this.weapon,
					owned: Array.isArray(f.owned) ? [true, f.owned[1] === true, f.owned[2] === true] : this.view.feedback?.owned ?? [true, false, false],
					scoped: f.scoped === true, ammo: Math.floor(bounded(f.ammo, 0, 0, magazineSize)),
					magazine_size: magazineSize,
					reloading: f.reloading === true, reload_progress: bounded(f.reload_progress, 0, 0, 1),
				} });
				return;
			}
			case "join_rejected":
				if (!this.view.myId) this.fail(message.message);
				else this.set({ ...this.view, error: message.message });
				return;
		}
	}

	private setGameState(state: GameState, patch: Partial<LobbyView>) {
		if (!gameStates.has(state)) return;
		const wasPlaying = this.view.stage === "playing";
		const wasPaused = this.view.state === "paused";
		const stage: LobbyStage = state === "playing" || state === "paused" ? "playing" : state === "ended" ? "ended" : this.view.myId ? "lobby" : this.view.stage;
		this.set({ ...this.view, ...patch, state, stage, error: stage === "lobby" ? null : this.view.error,
			status: stage === "lobby" ? null : this.view.status, result: stage === "lobby" ? null : this.view.result,
			feedback: stage === "lobby" ? null : this.view.feedback });
		if ((!wasPlaying && stage === "playing") || state === "paused" || wasPaused) {
			this.sentCrouch = false;
			this.sentSprint = false;
			if (!wasPlaying) this.weapon = 0;
			// Lobby gestures and pre-pause readings must never move a fresh match.
			this.latest = null;
			this.latestReading = null;
			this.lookDX = 0;
			this.lookDY = 0;
			this.firing = false;
		}
	}

	private clearJoinTimer() { if (this.joinTimer) clearTimeout(this.joinTimer); this.joinTimer = null; }
	private scheduleReconnect(error: string) {
		if (!this.wanted || this.reconnectTimer) return;
		// Never got in: after a few tries, stop and say why instead of retrying forever.
		if (!this.joinedOnce && this.reconnectAttempt + 1 >= firstJoinAttempts) {
			this.fail(`${error.replace(/\s*Retrying…$/, "")} Check your internet connection, then try again.`);
			return;
		}
		this.clearJoinTimer();
		this.stop();
		const delay = reconnectDelaysMs[Math.min(this.reconnectAttempt, reconnectDelaysMs.length - 1)];
		this.reconnectAttempt += 1;
		this.set({ ...this.view, stage: "connecting", error });
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.reconnecting = true;
			this.join(this.joinCode, this.joinName);
		}, delay);
	}
	private stop() {
		this.clearJoinTimer();
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.firing = false;
		this.sentCrouch = false;
		this.sentSprint = false;
		this.latest = null;
		this.latestReading = null;
		this.lookDX = 0;
		this.lookDY = 0;
	}
	private fail(error: string) {
		this.stop();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.set({ ...this.view, stage: "closed", error });
	}
	private send(message: object) {
		// React Native's WebSocket never sets bufferedAmount (it stays undefined), so treat
		// "unknown" as empty; comparing undefined would drop every message on phones.
		if (this.socket?.readyState === WebSocket.OPEN && (this.socket.bufferedAmount ?? 0) < 65536) this.socket.send(JSON.stringify(message));
	}
	private set(view: LobbyView) { this.view = view; this.onChange(view); }
}
