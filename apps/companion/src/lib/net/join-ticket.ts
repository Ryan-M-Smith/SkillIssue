export type JoinTarget = { code: string; serverUrl: string };

const codePattern = /^[A-Z0-9]{6}$/;

/** Accept a six-character code, host:port/CODE, or a shared app link. */
export function parseJoinTicket(input: string, fallbackUrl = ""): JoinTarget {
	const text = input.trim();
	let code = text.toUpperCase();
	let address = fallbackUrl.trim();
	if (!codePattern.test(code)) {
		let url: URL;
		try {
			url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `ws://${text}`);
		} catch {
			throw new Error("Enter the six-character code or paste the lobby ticket shown on the game screen.");
		}
		if (url.protocol === "skillissue:" || url.protocol === "companion:" || (["http:", "https:"].includes(url.protocol) && url.searchParams.has("server"))) {
			code = (url.searchParams.get("code") ?? "").toUpperCase();
			address = url.searchParams.get("server") ?? "";
		} else if (["ws:", "wss:", "http:", "https:"].includes(url.protocol)) {
			const path = url.pathname.split("/").filter(Boolean);
			const queryCode = url.searchParams.get("code");
			code = (queryCode ?? path.pop() ?? "").toUpperCase();
			url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
			if (!queryCode) url.pathname = `/${path.join("/")}`;
			url.searchParams.delete("code");
			url.hash = "";
			address = url.toString();
		} else {
			throw new Error("Use a lobby ticket from Skill Issue.");
		}
	}
	if (!codePattern.test(code)) throw new Error("The lobby code must contain six letters or numbers.");
	if (!address) throw new Error("Paste the full lobby ticket from the game screen to find your host automatically.");
	let server: URL;
	try {
		server = new URL(address);
	} catch {
		throw new Error("The host address is invalid. Paste a fresh lobby ticket from the game screen.");
	}
	if (!["ws:", "wss:"].includes(server.protocol) || !server.hostname || server.username || server.password || server.hash) {
		throw new Error("The game host must use a ws:// or wss:// address without credentials.");
	}
	return { code, serverUrl: server.toString() };
}
