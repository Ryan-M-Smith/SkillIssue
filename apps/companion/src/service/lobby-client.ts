import type {
	ControllerRole,
	EnvironmentAction,
	GameState,
	LobbyPlayer,
	MatchEndedMessage,
	MatchStatusMessage,
	MotionReading as ProtocolMotionReading,
	ServerMessage,
	TeamId,
} from "../../../../packages/protocol/events";
import type { GameControls, MotionReading } from "@/types/motion";
import { deviceRotationRate } from "@/lib/math/motion";

export type { ControllerRole, LobbyPlayer, TeamId } from "../../../../packages/protocol/events";

/** Where this phone is in the whiteboard flow. */
export type LobbyStage =
	| "idle" // not connected
	| "connecting"
	| "lobby" // picking a team + role, readying up
	| "playing"
	| "ended" // game over, waiting for Play Again or leaving
	| "closed"; // connection lost or rejected

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
};

export const idleLobby: LobbyView = {
	stage: "idle",
	error: null,
	code: "",
	myId: null,
	me: null,
	players: [],
	state: null,
	minPlayers: 4,
	status: null,
	result: null,
};

const motionHz = 30;
const tapMs = 120;
const zero = { x: 0, y: 0, z: 0 };
const degToRad = Math.PI / 180;

/**
 * The phone's connection to a SkillIssue lobby and match, through the server.
 * Join with the game's code, pick a spot, ready up; once playing, feed every
 * motion-model output to `update()` and it sends what the phone's role controls:
 * movement (move, jump, crouch, sprint) or aim (look, shoot, scope, weapons).
 */
export class LobbyClient {
	private socket: WebSocket | null = null;
	private view: LobbyView = { ...idleLobby };
	private timer: ReturnType<typeof setInterval> | null = null;
	private latest: GameControls | null = null;
	private latestReading: MotionReading | null = null;
	private sentCrouch = false;
	private sentSprint = false;
	private firing = false;

	constructor(
		private readonly url: string,
		private readonly platform: string,
		private readonly onChange: (view: LobbyView) => void = () => {}
	) {}

	get snapshot(): LobbyView {
		return this.view;
	}

	join(code: string, name: string) {
		this.leave();
		this.set({ ...idleLobby, stage: "connecting", code: code.toUpperCase() });

		let socket: WebSocket;
		try {
			socket = new WebSocket(this.url);
		} catch (e) {
			this.set({ ...idleLobby, stage: "closed", error: e instanceof Error ? e.message : String(e) });
			return;
		}
		this.socket = socket;

		socket.onopen = () => {
			this.send({ type: "join_game", protocolVersion: 1, pairingCode: code.trim().toUpperCase(), name: name.trim() });
		};
		socket.onmessage = (event) => this.receive(String(event.data));
		socket.onerror = () => {
			this.set({ ...this.view, error: `Can't reach the server at ${this.url}. Check the address in Settings.` });
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.stopMotion();
			this.set({ ...this.view, stage: "closed", error: this.view.error ?? "Lost the connection to the game." });
		};

		this.timer = setInterval(() => this.sendMotion(), 1000 / motionHz);
	}

	leave() {
		this.stopMotion();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.set({ ...idleLobby });
	}

	selectSlot(teamId: TeamId, role: ControllerRole) {
		this.send({ type: "select_slot", teamId, role });
	}

	setReady(ready: boolean) {
		this.send({ type: "set_ready", ready });
	}

	/** Feed every motion-model output (and its reading). Sends gestures right away. */
	update(controls: GameControls, reading: MotionReading) {
		this.latest = controls;
		this.latestReading = reading;
		if (this.view.stage !== "playing") return;

		if (this.view.me?.role === "movement") {
			if (controls.action === "jump") this.sendAction("jump", true);
			this.syncHeld(controls);
		} else if (this.view.me?.role === "aim" && controls.action === "shoot" && !this.firing) {
			this.sendAction("shoot", true);
			setTimeout(() => {
				if (!this.firing) this.sendAction("shoot", false);
			}, tapMs);
		}
	}

	/** Aim phone: the on-screen FIRE button, held. */
	setFiring(down: boolean) {
		if (this.view.stage !== "playing" || this.view.me?.role !== "aim" || down === this.firing) return;
		this.firing = down;
		this.sendAction("shoot", down);
	}

	/** Aim phone: toggle the scope. */
	toggleScope() {
		if (this.view.stage === "playing" && this.view.me?.role === "aim") this.sendAction("scope", true);
	}

	/** Aim phone: 0 pistol, 1 shotgun, 2 sniper (only guns you've picked up). */
	selectWeapon(slot: number) {
		if (this.view.stage === "playing" && this.view.me?.role === "aim") {
			this.send({ type: "environment", timestamp: Date.now(), payload: { action: "weapon", pressed: true, slot } });
		}
	}

	private syncHeld(controls: GameControls) {
		if (controls.crouch !== this.sentCrouch) {
			this.sentCrouch = controls.crouch;
			this.sendAction("crouch", controls.crouch);
		}
		if (controls.sprint !== this.sentSprint) {
			this.sentSprint = controls.sprint;
			this.sendAction("sprint", controls.sprint);
		}
	}

	private sendAction(action: EnvironmentAction, pressed: boolean) {
		this.send({ type: "environment", timestamp: Date.now(), payload: { action, pressed } });
	}

	private sendMotion() {
		if (this.view.stage !== "playing" || !this.latest || !this.view.me?.role) return;
		const c = this.latest;
		const reading = this.latestReading;
		const gyro = reading?.rotationRate ? deviceRotationRate(reading.rotationRate, this.platform) : zero;
		const g = reading?.accelerationIncludingGravity ?? zero;
		const movement = this.view.me.role === "movement";
		const payload: ProtocolMotionReading = {
			accelerometer: { x: g.x, y: g.y, z: g.z },
			gyroscope: { x: gyro.x * degToRad, y: gyro.y * degToRad, z: gyro.z * degToRad },
			arPosition: zero,
			arOrientation: zero,
			trackingStatus: "unavailable",
			controls: {
				moveX: movement && c.ready ? c.moveX : 0,
				moveY: movement && c.ready ? c.moveY : 0,
				lookX: !movement && c.ready ? c.lookX : 0,
				lookY: !movement && c.ready ? c.lookY : 0,
			},
		};
		this.send({ type: "motion", timestamp: Date.now(), payload });
	}

	private receive(text: string) {
		let message: ServerMessage;
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}

		switch (message.type) {
			case "lobby_joined":
				this.set({ ...this.view, stage: "lobby", myId: message.controllerId, code: message.pairingCode, error: null });
				return;
			case "lobby_state": {
				const me = message.players.find((p) => p.controllerId === this.view.myId) ?? null;
				this.setGameState(message.state, { players: message.players, me, minPlayers: message.minPlayers });
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
			case "join_rejected":
				if (!this.view.myId) {
					this.stopMotion();
					const socket = this.socket;
					this.socket = null;
					socket?.close();
					this.set({ ...idleLobby, stage: "closed", error: message.message });
				} else {
					this.set({ ...this.view, error: message.message });
				}
				return;
		}
	}

	private setGameState(state: GameState, patch: Partial<LobbyView>) {
		const wasPlaying = this.view.stage === "playing";
		let stage = this.view.stage;
		if (state === "playing") stage = "playing";
		else if (state === "ended") stage = "ended";
		else if (this.view.myId) stage = "lobby"; // waiting / ready (also after Play Again)
		this.set({
			...this.view,
			...patch,
			state,
			stage,
			error: stage === "lobby" && this.view.stage !== "lobby" ? null : this.view.error,
			status: stage === "lobby" ? null : this.view.status,
			result: stage === "lobby" ? null : this.view.result,
		});
		if (!wasPlaying && stage === "playing") {
			// Kick-off: line the game's held states up with ours.
			this.sentCrouch = false;
			this.sentSprint = false;
			this.firing = false;
			if (this.latest && this.view.me?.role === "movement") this.syncHeld(this.latest);
		}
	}

	private stopMotion() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.sentCrouch = false;
		this.sentSprint = false;
		this.firing = false;
	}

	private send(message: object) {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private set(view: LobbyView) {
		this.view = view;
		this.onChange(view);
	}
}
