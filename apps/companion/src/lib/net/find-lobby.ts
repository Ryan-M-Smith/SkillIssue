import { LobbyClient, type LobbyView } from "@/service/lobby-client";

/** The control plane Godot asks for a game by default (project setting network/control_plane_url). */
export const defaultControlPlane = "https://skillissue.vodka";

const lookupTimeoutMs = 5000;
let relayLookup: Promise<string> | null = null;

/**
 * The public relay games are hosted on: EXPO_PUBLIC_GAME_SERVER when set, otherwise
 * what the control plane reports at /api/connection (the same place Godot provisions
 * its game). "" when there is none or it can't be reached.
 */
export function publicGameServer(fetchImpl: typeof fetch = fetch): Promise<string> {
	const configured = process.env.EXPO_PUBLIC_GAME_SERVER?.trim();
	if (configured) return Promise.resolve(configured);
	relayLookup ??= (async () => {
		const base = (process.env.EXPO_PUBLIC_CONTROL_PLANE?.trim() || defaultControlPlane).replace(/\/+$/, "");
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), lookupTimeoutMs);
		try {
			const res = await fetchImpl(`${base}/api/connection`, { signal: abort.signal });
			if (!res.ok) return "";
			const body = (await res.json()) as { websocketUrl?: unknown };
			const url = typeof body.websocketUrl === "string" ? body.websocketUrl.trim() : "";
			return /^wss?:\/\/./i.test(url) ? url : "";
		} catch {
			return "";
		} finally {
			clearTimeout(timer);
		}
	})();
	return relayLookup.then((url) => {
		if (!url) relayLookup = null; // try again next time
		return url;
	});
}

/** For tests: forget the cached relay lookup. */
export function resetPublicGameServer() {
	relayLookup = null;
}

type MakeClient = (url: string, onChange: (view: LobbyView) => void) => LobbyClient;

/**
 * Joins lobby `code` on the first of `servers` that has it. A bare code doesn't say
 * where its lobby lives: on the public relay (the game's default) or on the game
 * computer itself (LAN). Each server is tried in order; a server that rejects the
 * code or can't be reached is skipped. The last one keeps the client's usual retries,
 * unless an earlier server already said the code is wrong: then that's the answer.
 *
 * `onClient` is told which client is current, `onChange` gets its views. Returns a
 * function that cancels the search.
 */
export function joinFirstAvailable(
	servers: string[],
	code: string,
	name: string,
	platform: string,
	onClient: (client: LobbyClient, serverUrl: string) => void,
	onChange: (view: LobbyView) => void,
	makeClient: MakeClient = (url, change) => new LobbyClient(url, platform, change),
): () => void {
	let index = -1;
	let cancelled = false;
	let rejection: string | null = null;
	let current: LobbyClient | null = null;

	const next = () => {
		index += 1;
		const url = servers[index];
		const last = index === servers.length - 1;
		let joined = false;
		let done = false;
		const client = makeClient(url, (view) => {
			if (cancelled || done || client !== current) return;
			if (view.myId) joined = true;
			if (!joined) {
				const refused = view.stage === "closed";
				const unreachable = view.stage === "connecting" && !!view.error;
				if (refused && /match an open lobby|pairing/i.test(view.error ?? "")) rejection = view.error;
				// The client reports these from inside its own retry logic, before it arms its
				// retry timer; leave it on the next microtask so leave() cancels that timer too.
				if (!last && (refused || unreachable)) {
					done = true;
					queueMicrotask(() => {
						client.leave();
						if (!cancelled) next();
					});
					return;
				}
				if (last && unreachable && rejection) {
					done = true;
					const answer: LobbyView = { ...view, stage: "closed", error: rejection };
					queueMicrotask(() => {
						client.leave();
						if (!cancelled) onChange(answer);
					});
					return;
				}
			}
			onChange(view);
		});
		current = client;
		onClient(client, url);
		client.join(code, name);
	};

	if (servers.length === 0) return () => {};
	next();
	return () => {
		cancelled = true;
	};
}
