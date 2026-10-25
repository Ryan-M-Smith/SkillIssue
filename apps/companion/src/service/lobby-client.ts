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

const motionHz = 30;
const tapMs = 120;
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
	private shotTimer: ReturnType<typeof setTimeout> | null = null;
	private latest: GameControls | null = null;
	private latestReading: MotionReading | null = null;
	private latestAt = 0;
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
		this.leave();
		this.set({ ...idleLobby, stage: "connecting", code: code.trim().toUpperCase() });
		let socket: WebSocket;
		try { socket = new WebSocket(this.url); }
		catch { this.fail("Invalid host address. Paste the full lobby ticket from the game screen."); return; }
		this.socket = socket;
		this.joinTimer = setTimeout(() => {
			if (this.socket === socket && this.view.stage === "connecting") {
				this.fail("The game did not answer in time. Keep its lobby open, use the same Wi-Fi, and paste the full lobby ticket to retry.");
			}
		}, 10000);
		socket.onopen = () => {
			if (this.socket === socket) this.send({ type: "join_game", protocolVersion: 1, pairingCode: code.trim().toUpperCase(), name: name.trim().slice(0, 16) || "Player" });
		};
		socket.onmessage = (event) => { if (this.socket === socket) this.receive(String(event.data)); };
		socket.onerror = () => {
			if (this.socket === socket) this.fail("Can't reach this game. Keep its lobby open and paste its full ticket. Both devices must be on the same Wi-Fi.");
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			this.fail(this.view.error ?? "Connection lost. Rejoin using the ticket in the game lobby.");
		};
		this.timer = setInterval(() => this.sendMotion(), 1000 / motionHz);
	}

	leave() {
		this.stop();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.set({ ...idleLobby });
	}

	selectSlot(teamId: TeamId, role: ControllerRole) { this.send({ type: "select_slot", teamId, role }); }
	setReady(ready: boolean) { this.send({ type: "set_ready", ready }); }

	update(controls: GameControls, reading: MotionReading) {
		this.latest = controls;
		this.latestReading = reading;
		this.latestAt = Date.now();
		if (this.view.stage !== "playing" || this.view.state === "paused" || !controls.ready) return;
		if (this.view.me?.role === "movement") {
			if (controls.action === "jump") this.sendAction("jump", true);
			this.syncHeld(controls);
		} else if (this.view.me?.role === "aim") {
			switch (controls.action) {
				case "shoot":
					if (this.shotTimer) clearTimeout(this.shotTimer);
					this.sendAction("shoot", true);
					this.shotTimer = setTimeout(() => { this.shotTimer = null; this.sendAction("shoot", false); }, tapMs);
					break;
				case "reload": this.sendAction("reload", true); break;
				case "scope": this.sendAction("scope", true); break;
				case "weapon_next": {
					const owned = this.view.feedback?.owned ?? [true, false, false];
					for (let step = 1; step <= owned.length; step++) {
						const slot = (this.weapon + step) % owned.length;
						if (owned[slot]) { this.selectWeapon(slot); break; }
					}
					break;
				}
			}
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
				lookX: !movement && fresh ? c.lookX : 0, lookY: !movement && fresh ? c.lookY : 0 },
		};
		this.send({ type: "motion", timestamp: Date.now(), payload });
	}

	private receive(text: string) {
		if (text.length > 65536) return;
		let message: ServerMessage;
		try { message = JSON.parse(text); } catch { return; }
		if (!message || typeof message !== "object") return;
		switch (message.type) {
			case "lobby_joined":
				this.clearJoinTimer();
				this.set({ ...this.view, stage: "lobby", myId: message.controllerId, code: message.pairingCode, error: null });
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
				this.set({ ...this.view, stage: "ended", result: { winningTeam: message.winningTeam, scores: message.scores, stats: message.stats } });
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
			if (this.shotTimer) clearTimeout(this.shotTimer);
			this.shotTimer = null;
		}
	}

	private clearJoinTimer() { if (this.joinTimer) clearTimeout(this.joinTimer); this.joinTimer = null; }
	private stop() {
		this.clearJoinTimer();
		if (this.timer) clearInterval(this.timer);
		if (this.shotTimer) clearTimeout(this.shotTimer);
		this.timer = null;
		this.shotTimer = null;
		this.sentCrouch = false;
		this.sentSprint = false;
		this.latest = null;
		this.latestReading = null;
	}
	private fail(error: string) {
		this.stop();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.set({ ...this.view, stage: "closed", error });
	}
	private send(message: object) {
		if (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 65536) this.socket.send(JSON.stringify(message));
	}
	private set(view: LobbyView) { this.view = view; this.onChange(view); }
}
