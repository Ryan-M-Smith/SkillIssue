import type {
	DebugEventMessage,
	DebugMotionMessage,
	DebugMotionReading,
	DebugRole,
	DebugServerMessage,
} from "../../../../packages/protocol/events";
import type { MotionReading } from "@/types/motion";

export type DebugLinkStatus = {
	state: "idle" | "connecting" | "connected" | "retrying";
	/** Why the last attempt failed, if it did. */
	error: string | null;
	phones: number;
	viewers: number;
	/** ws:// addresses the server says it can be reached on. */
	addresses: string[];
};

export const idleLinkStatus: DebugLinkStatus = {
	state: "idle",
	error: null,
	phones: 0,
	viewers: 0,
	addresses: [],
};

type Handlers = {
	onStatus?: (status: DebugLinkStatus) => void;
	onMotion?: (message: DebugMotionMessage) => void;
	onEvent?: (event: DebugEventMessage["event"]) => void;
};

const flushMs = 50;
const maxBatch = 50;
const retryMs = [1000, 2000, 4000, 8000];

const round = (v: number) => Math.round(v * 1e4) / 1e4;

// Keep only what the motion model reads, rounded to keep messages small.
function slim(reading: MotionReading): DebugMotionReading {
	const r = reading.rotation;
	const rr = reading.rotationRate;
	const a = reading.acceleration;
	const g = reading.accelerationIncludingGravity;
	return {
		rotation: { alpha: round(r.alpha), beta: round(r.beta), gamma: round(r.gamma), timestamp: r.timestamp },
		rotationRate: rr ? { alpha: round(rr.alpha), beta: round(rr.beta), gamma: round(rr.gamma), timestamp: rr.timestamp } : null,
		acceleration: a ? { x: round(a.x), y: round(a.y), z: round(a.z), timestamp: a.timestamp } : null,
		accelerationIncludingGravity: { x: round(g.x), y: round(g.y), z: round(g.z), timestamp: g.timestamp },
	};
}

/**
 * Connection to the SkillIssue server's debug relay. A phone joins as
 * "phone" and streams readings; a browser joins as "viewer" and receives
 * them. Reconnects on its own until `close()`.
 */
export class DebugLink {
	private socket: WebSocket | null = null;
	private status: DebugLinkStatus = { ...idleLinkStatus };
	private queue: DebugMotionReading[] = [];
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private attempt = 0;
	private wanted = false;

	constructor(
		private readonly url: string,
		private readonly room: string,
		private readonly role: DebugRole,
		private readonly platform: string,
		private readonly handlers: Handlers = {}
	) {}

	open() {
		this.wanted = true;
		this.connect();
		if (this.role === "phone" && !this.flushTimer) {
			this.flushTimer = setInterval(() => this.flush(), flushMs);
		}
	}

	close() {
		this.wanted = false;
		if (this.retryTimer) clearTimeout(this.retryTimer);
		if (this.flushTimer) clearInterval(this.flushTimer);
		this.retryTimer = null;
		this.flushTimer = null;
		this.queue = [];
		const socket = this.socket;
		this.socket = null;
		socket?.close();
		this.setStatus({ ...idleLinkStatus });
	}

	/** Phone: queue one reading for the next batch. Dropped while offline. */
	sendReading(reading: MotionReading) {
		if (this.status.state !== "connected") return;
		this.queue.push(slim(reading));
		if (this.queue.length >= maxBatch) this.flush();
	}

	sendEvent(event: DebugEventMessage["event"]) {
		this.send({ type: "debug_event", event });
	}

	private connect() {
		if (!this.wanted) return;
		this.setStatus({ ...this.status, state: this.attempt === 0 ? "connecting" : "retrying" });

		let socket: WebSocket;
		try {
			socket = new WebSocket(this.url);
		} catch (e) {
			this.setStatus({ ...this.status, state: "retrying", error: e instanceof Error ? e.message : String(e) });
			this.scheduleRetry();
			return;
		}
		this.socket = socket;

		socket.onopen = () => {
			this.attempt = 0;
			this.send({ type: "debug_join", protocolVersion: 1, room: this.room, role: this.role });
		};
		socket.onmessage = (event) => this.receive(String(event.data));
		socket.onerror = () => {
			this.setStatus({ ...this.status, error: `Can't reach ${this.url}. Is the server running, and is this the right address?` });
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.queue = [];
			if (this.wanted) {
				this.setStatus({ ...this.status, state: "retrying", phones: 0, viewers: 0 });
				this.scheduleRetry();
			}
		};
	}

	private scheduleRetry() {
		if (!this.wanted || this.retryTimer) return;
		const delay = retryMs[Math.min(this.attempt, retryMs.length - 1)];
		this.attempt++;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.connect();
		}, delay);
	}

	private receive(text: string) {
		let message: DebugServerMessage | { type: "join_rejected"; message: string };
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}

		switch (message.type) {
			case "debug_joined":
				this.setStatus({ ...this.status, state: "connected", error: null, addresses: message.addresses ?? [] });
				return;
			case "debug_status":
				this.setStatus({ ...this.status, phones: message.phones, viewers: message.viewers });
				return;
			case "debug_motion":
				this.handlers.onMotion?.(message);
				return;
			case "debug_event":
				this.handlers.onEvent?.(message.event);
				return;
			case "join_rejected":
				this.setStatus({ ...this.status, error: message.message });
				return;
		}
	}

	private flush() {
		if (!this.queue.length || this.status.state !== "connected") return;
		const readings = this.queue;
		this.queue = [];
		this.send({ type: "debug_motion", platform: this.platform, readings });
	}

	private send(message: object) {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(message));
		}
	}

	private setStatus(status: DebugLinkStatus) {
		this.status = status;
		this.handlers.onStatus?.({ ...status });
	}
}
