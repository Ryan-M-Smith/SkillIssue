import type {
	ControllerAssignment,
	EnvironmentAction,
	GameState,
	MotionReading as ProtocolMotionReading,
	ServerMessage,
} from "../../../../packages/protocol/events";
import type { GameControls, MotionReading } from "@/types/motion";
import { deviceRotationRate } from "@/lib/math/motion";

export type GameLinkStatus = {
	state: "idle" | "connecting" | "joined" | "closed";
	/** Lobby / match state from the server, once joined. */
	game: GameState | null;
	/** 1 or 2 once assigned. */
	team: number | null;
	/** How many phones are in the lobby, including this one. */
	players: number;
	/** Last problem: rejected join, lost connection, ignored input. */
	error: string | null;
};

export const idleGameStatus: GameLinkStatus = {
	state: "idle",
	game: null,
	team: null,
	players: 0,
	error: null,
};

const motionHz = 30;
const zero = { x: 0, y: 0, z: 0 };
const degToRad = Math.PI / 180;

/**
 * The movement phone's connection to a SkillIssue match, through the server.
 * Joins with the game's pairing code, then (once the match is playing)
 * sends the phone's computed movement at 30 Hz and its gestures as
 * `environment` actions. Feed it every model output with `update()`.
 */
export class GameLink {
	private socket: WebSocket | null = null;
	private status: GameLinkStatus = { ...idleGameStatus };
	private timer: ReturnType<typeof setInterval> | null = null;
	private latest: GameControls | null = null;
	private latestReading: MotionReading | null = null;
	private sentCrouch = false;
	private sentSprint = false;

	constructor(
		private readonly url: string,
		private readonly platform: string,
		private readonly onStatus: (status: GameLinkStatus) => void = () => {}
	) {}

	join(pairingCode: string) {
		this.leave();
		this.setStatus({ ...idleGameStatus, state: "connecting" });

		let socket: WebSocket;
		try {
			socket = new WebSocket(this.url);
		} catch (e) {
			this.setStatus({ ...idleGameStatus, state: "closed", error: e instanceof Error ? e.message : String(e) });
			return;
		}
		this.socket = socket;

		socket.onopen = () => {
			this.send({ type: "join_game", protocolVersion: 1, pairingCode, requestedRole: "movement" });
		};
		socket.onmessage = (event) => this.receive(String(event.data));
		socket.onerror = () => {
			this.setStatus({ ...this.status, error: `Can't reach ${this.url}. Is the server running, and is this the right address?` });
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.stopMotion();
			this.setStatus({
				...this.status,
				state: "closed",
				game: null,
				error: this.status.error ?? "Disconnected from the game.",
			});
		};

		this.timer = setInterval(() => this.sendMotion(), 1000 / motionHz);
	}

	leave() {
		this.stopMotion();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.setStatus({ ...idleGameStatus });
	}

	/** Feed every motion-model output (and its reading); sends gestures right away. */
	update(controls: GameControls, reading: MotionReading) {
		this.latest = controls;
		this.latestReading = reading;
		if (!this.playing()) return;

		if (controls.action === "jump") {
			this.sendAction("jump", true);
		}
		this.syncHeld(controls);
	}

	private playing() {
		return this.status.state === "joined" && this.status.game === "playing";
	}

	// Crouch and sprint are held states in the game: send each change.
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
		if (!this.playing() || !this.latest) return;
		const reading = this.latestReading;
		const gyro = reading?.rotationRate ? deviceRotationRate(reading.rotationRate, this.platform) : zero;
		const g = reading?.accelerationIncludingGravity ?? zero;
		const payload: ProtocolMotionReading = {
			accelerometer: { x: g.x, y: g.y, z: g.z },
			gyroscope: { x: gyro.x * degToRad, y: gyro.y * degToRad, z: gyro.z * degToRad },
			arPosition: zero,
			arOrientation: zero,
			trackingStatus: "unavailable",
			controls: {
				moveX: this.latest.ready ? this.latest.moveX : 0,
				moveY: this.latest.ready ? this.latest.moveY : 0,
				lookX: 0,
				lookY: 0,
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
			case "controller_assigned":
				this.setStatus({ ...this.status, state: "joined", team: message.assignment.teamId, error: null });
				return;
			case "lobby_state":
				this.setGame(message.state, message.assignments);
				return;
			case "broadcast":
				if (message.state) this.setGame(message.state);
				if (message.error) this.setStatus({ ...this.status, error: message.error });
				return;
			case "join_rejected":
				this.setStatus({ ...this.status, error: message.message });
				if (this.status.state !== "joined") this.leaveWithError(message.message);
				return;
		}
	}

	private setGame(game: GameState, assignments?: ControllerAssignment[]) {
		const wasPlaying = this.playing();
		this.setStatus({
			...this.status,
			game,
			players: assignments ? assignments.filter((a) => a.connected).length : this.status.players,
		});
		if (!wasPlaying && this.playing()) {
			// Match just started: bring the game's held states in line with ours.
			this.sentCrouch = false;
			this.sentSprint = false;
			if (this.latest) this.syncHeld(this.latest);
		}
	}

	private leaveWithError(error: string) {
		this.stopMotion();
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.setStatus({ ...idleGameStatus, state: "closed", error });
	}

	private stopMotion() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.sentCrouch = false;
		this.sentSprint = false;
	}

	private send(message: object) {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private setStatus(status: GameLinkStatus) {
		this.status = status;
		this.onStatus({ ...status });
	}
}
