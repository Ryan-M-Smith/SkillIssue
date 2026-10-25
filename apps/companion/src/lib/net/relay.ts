/** The control plane Godot asks for a game by default (project setting network/control_plane_url). */
export const defaultControlPlane = "https://skillissue.vodka";

const lookupTimeoutMs = 5000;
let relayLookup: Promise<string> | null = null;

/**
 * The Skill Issue relay every lobby lives on: EXPO_PUBLIC_GAME_SERVER when set, otherwise
 * what the control plane reports at /api/connection (the same place the game provisions
 * its lobby). "" when it can't be reached.
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
