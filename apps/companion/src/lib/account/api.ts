import Constants from "expo-constants";
import { Platform } from "react-native";

/** What GET /api/config returns: where to sign in (Auth0) and whether stats are stored. */
export type ApiConfig = {
	auth: {
		domain: string;
		/** Base URL of the Auth0 endpoints, https://<domain>/. */
		issuer?: string;
		audience: string;
		webClientId: string | null;
		nativeClientId: string | null;
		connections: { google: string; github: string };
	} | null;
	database: boolean;
};

export type PlayerTotals = {
	rank?: number;
	player_id: string;
	display_name: string;
	avatar_url: string | null;
	provider: string | null;
	matches: number;
	wins: number;
	kills: number;
	deaths: number;
	shots: number;
	hits: number;
	headshots: number;
	distance_m: number;
	jumps: number;
	crouches: number;
	sprint_s: number;
	accuracy: number;
	kd: number;
};

export type MatchSummary = {
	id: string;
	ended_at: string;
	reason: string | null;
	winning_team: 1 | 2 | null;
	blue_score: number;
	red_score: number;
	duration_s: number | null;
	players: { name: string; avatar: string | null; teamId: 1 | 2; role: "movement" | "aim"; signedIn: boolean; kills: number }[];
};

export type Summary = {
	matches: number;
	players: number;
	kills: number;
	matches_today: number;
	hourly: { hour: string; matches: number }[];
	recent: MatchSummary[];
};

export type MyStats = {
	player: { id: string; display_name: string; avatar_url: string | null; provider: string | null; created_at: string };
	totals: PlayerTotals | null;
	rank: number | null;
	daily: { day: string; matches: number; wins: number; kills: number }[];
	recent: MatchSummary[];
};

export type LeaderboardSort = "wins" | "kills" | "accuracy" | "kd" | "distance" | "matches";

const apiPort = 3000;

/**
 * Where the SkillIssue API (apps/api) lives. EXPO_PUBLIC_API_URL wins. Otherwise
 * the website uses the server it was loaded from (in development, port 3000 on the
 * same computer) and the phone uses the computer running the Expo dev server.
 */
export function defaultApiUrl(): string {
	const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
	if (fromEnv) return fromEnv.replace(/\/+$/, "");
	if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
		const { protocol, hostname, port, origin } = window.location;
		const devServer = port === "8081" || port === "8085" || port === "19006";
		return devServer ? `${protocol}//${hostname}:${apiPort}` : origin;
	}
	const host = (Constants.expoConfig?.hostUri ?? "").split(":")[0];
	return host && !host.endsWith("exp.direct") ? `http://${host}:${apiPort}` : "";
}

export class ApiError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

export async function apiGet<T>(base: string, path: string, token?: string | null): Promise<T> {
	if (!base) throw new ApiError(0, "Set the website address in Settings to sign in and see stats.");
	let res: Response;
	try {
		res = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
	} catch {
		throw new ApiError(0, `Can't reach ${base}.`);
	}
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}).`);
	return body as T;
}
