import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

import { AuthError, bearer, identify, type Identity } from "./auth.ts";
import { authEnabled, config } from "./config.ts";
import * as store from "./db.ts";

const maxBody = 64 * 1024;
const roles = ["movement", "aim"] as const;

class HttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

// ---------------------------------------------------------------- routes

type Handler = (req: IncomingMessage, url: URL) => Promise<unknown>;

const routes: Record<string, Handler> = {
	"GET /api/health": async () => {
		let db = false;
		if (store.dbEnabled()) {
			db = await store.db().query("select 1").then(() => true, () => false);
		}
		return { ok: true, db, auth: authEnabled() };
	},

	/** Public settings the website, phone app and game need to sign people in. */
	"GET /api/config": async () => ({
		auth: authEnabled()
			? {
				domain: config.auth0.domain,
				audience: config.auth0.audience,
				webClientId: config.auth0.webClientId || null,
				nativeClientId: config.auth0.nativeClientId || null,
				connections: { google: "google-oauth2", github: "github" },
			}
			: null,
		database: store.dbEnabled(),
	}),

	"GET /api/leaderboard": async (_req, url) => {
		const period = url.searchParams.get("period") === "week" ? "week" : "all";
		const sortParam = url.searchParams.get("sort") ?? "wins";
		const sort = (sortParam in store.sorts ? sortParam : "wins") as store.Sort;
		const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
		return { period, sort, players: await store.leaderboard(period, sort, limit) };
	},

	"GET /api/summary": async () => store.summary(),

	/** The signed-in player's profile, career totals, rank, last 30 days and recent matches. */
	"GET /api/me": async (req) => {
		const who = await signedIn(req);
		const player = await store.upsertPlayer(who);
		return { player, ...(await store.playerStats(who.sub)) };
	},

	/** The game uploads a finished match. The game must be signed in. */
	"POST /api/matches": async (req) => {
		const host = await signedIn(req);
		await store.upsertPlayer(host);
		const body = await readJson(req);
		return { saved: true, ...(await saveMatch(host, body)) };
	},
};

async function signedIn(req: IncomingMessage): Promise<Identity> {
	const token = bearer(req.headers.authorization);
	if (!token) throw new HttpError(401, "Sign in first (missing Authorization: Bearer token).");
	try {
		return await identify(token);
	} catch (e) {
		if (e instanceof AuthError) throw new HttpError(401, e.message);
		throw e;
	}
}

// ---------------------------------------------------------------- match upload

type UploadPlayer = { teamId?: unknown; role?: unknown; name?: unknown; token?: unknown };
type UploadTeam = Record<string, unknown>;

const int = (v: unknown, max = 1_000_000) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/**
 * Turns what the game sends into one row per phone. Each phone's token is checked
 * on its own: a phone that signed in counts toward its owner's stats; anyone else
 * is saved as a guest. The duo shares kills, deaths and the result; shots, hits and
 * headshots go to the aim phone, movement stats to the movement phone.
 */
async function saveMatch(host: Identity, body: Record<string, unknown>) {
	const players = Array.isArray(body.players) ? (body.players as UploadPlayer[]).slice(0, 4) : [];
	const teams = Array.isArray(body.teams) ? (body.teams as UploadTeam[]) : [];
	const scoresIn = Array.isArray(body.scores) ? body.scores : [];
	if (players.length === 0) throw new HttpError(400, "A match needs at least one player.");
	const scores: [number, number] = [int(scoresIn[0], 1000), int(scoresIn[1], 1000)];
	const winningTeam = body.winningTeam === 1 || body.winningTeam === 2 ? body.winningTeam : null;
	const teamStats = (teamId: number) => teams.find((t) => Number(t.teamId) === teamId) ?? {};

	const seen = new Set<string>();
	const rows: store.MatchRow[] = [];
	for (const p of players) {
		const teamId = p.teamId === 1 || p.teamId === 2 ? p.teamId : null;
		const role = roles.find((r) => r === p.role);
		if (!teamId || !role) throw new HttpError(400, "Each player needs teamId 1 or 2 and role movement or aim.");
		const name = typeof p.name === "string" ? p.name.trim().slice(0, 32) || null : null;

		let playerId: string | null = null;
		if (typeof p.token === "string" && p.token) {
			try {
				const who = await identify(p.token);
				if (!seen.has(who.sub)) {
					seen.add(who.sub);
					await store.upsertPlayer(who, name);
					playerId = who.sub;
				}
			} catch (e) {
				if (!(e instanceof AuthError)) throw e;
				// expired or forged: this phone plays as a guest
			}
		}

		const t = teamStats(teamId);
		const aim = role === "aim";
		rows.push({
			playerId,
			guestName: playerId ? null : name ?? "Guest",
			teamId,
			role,
			won: winningTeam === teamId,
			draw: winningTeam === null,
			kills: int(t.kills),
			deaths: int(t.deaths),
			shots: aim ? int(t.shots) : 0,
			hits: aim ? int(t.hits) : 0,
			headshots: aim ? int(t.headshots) : 0,
			distance: aim ? 0 : Math.max(0, Math.min(1e6, Number(t.distance) || 0)),
			jumps: aim ? 0 : int(t.jumps),
			crouches: aim ? 0 : int(t.crouches),
			sprint: aim ? 0 : Math.max(0, Math.min(1e5, Number(t.sprintTime) || 0)),
		});
	}

	const result = await store.saveMatch({
		clientKey: typeof body.matchKey === "string" ? body.matchKey.slice(0, 64) : null,
		hostId: host.sub,
		lobbyCode: typeof body.lobbyCode === "string" ? body.lobbyCode.slice(0, 12) : null,
		reason: body.reason === "kills" || body.reason === "time" ? body.reason : null,
		winningTeam,
		scores,
		durationS: body.durationS == null ? null : int(body.durationS, 24 * 3600),
		rows,
	});
	return { ...result, signedInPlayers: rows.filter((r) => r.playerId).length, guests: rows.filter((r) => !r.playerId).length };
}

// ---------------------------------------------------------------- plumbing

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBody) throw new HttpError(413, "Request too large.");
		chunks.push(chunk as Buffer);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (value && typeof value === "object" && !Array.isArray(value)) return value;
	} catch {
		// fall through
	}
	throw new HttpError(400, "Body must be a JSON object.");
}

function cors(req: IncomingMessage, res: ServerResponse) {
	const origin = req.headers.origin;
	if (!origin) return;
	if (config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
		res.setHeader("access-control-allow-origin", origin);
		res.setHeader("vary", "origin");
		res.setHeader("access-control-allow-headers", "authorization, content-type");
		res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
		res.setHeader("access-control-max-age", "600");
	}
}

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

const types: Record<string, string> = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
	".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
	".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".webp": "image/webp", ".txt": "text/plain",
};

/** The website: files from the web export, and index.html for app routes (/debug, ...). */
function serveWeb(url: URL, res: ServerResponse) {
	const root = config.webDir;
	let path = normalize(join(root, decodeURIComponent(url.pathname)));
	if (!path.startsWith(root)) return send(res, 404, { error: "Not found." });
	if (!existsSync(path) || statSync(path).isDirectory()) {
		const page = join(path, "index.html");
		path = existsSync(page) ? page : existsSync(`${path}.html`) ? `${path}.html` : join(root, "index.html");
	}
	if (!existsSync(path)) {
		return send(res, 404, { error: "The website isn't built yet. Run `npm run web:build` in the repo root." });
	}
	const immutable = url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/");
	res.writeHead(200, {
		"content-type": types[extname(path)] ?? "application/octet-stream",
		"cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
	});
	createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	cors(req, res);
	if (req.method === "OPTIONS") {
		res.writeHead(204).end();
		return;
	}
	const handler = routes[`${req.method} ${url.pathname.replace(/\/+$/, "")}`];
	if (!handler) {
		if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found." });
		if (req.method === "GET" || req.method === "HEAD") return serveWeb(url, res);
		return send(res, 405, { error: "Method not allowed." });
	}
	try {
		send(res, 200, await handler(req, url));
	} catch (e) {
		if (e instanceof HttpError) return send(res, e.status, { error: e.message });
		const message = (e as Error).message ?? String(e);
		if (/DATABASE_URL/.test(message)) return send(res, 503, { error: message });
		console.error(`${req.method} ${url.pathname}:`, e);
		send(res, 500, { error: "Something went wrong on the server." });
	}
});

server.listen(config.port, () => {
	console.log(`SkillIssue API on http://localhost:${config.port}`);
	console.log(`  database: ${store.dbEnabled() ? "Tiger Cloud (DATABASE_URL)" : "not set (DATABASE_URL)"}`);
	console.log(`  sign-in:  ${authEnabled() ? `Auth0 ${config.auth0.domain}` : "not set (AUTH0_DOMAIN, AUTH0_AUDIENCE)"}`);
	console.log(`  website:  ${existsSync(join(config.webDir, "index.html")) ? config.webDir : "not built (npm run web:build)"}`);
});
