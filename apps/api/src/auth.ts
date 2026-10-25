import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { authEnabled, config } from "./config.ts";

export type Identity = {
	/** Auth0 user id, e.g. "google-oauth2|1234" or "github|5678". */
	sub: string;
	provider: string;
	name: string | null;
	picture: string | null;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const profiles = new Map<string, { at: number; name: string | null; picture: string | null }>();
const profileTtlMs = 10 * 60_000;

export class AuthError extends Error {}

/** Checks an Auth0 access token (signature, issuer, audience, expiry). */
export async function verifyToken(token: string): Promise<JWTPayload & { sub: string }> {
	if (!authEnabled()) throw new AuthError("Sign-in isn't set up on this server (AUTH0_DOMAIN / AUTH0_AUDIENCE).");
	jwks ??= createRemoteJWKSet(new URL(".well-known/jwks.json", config.auth0.issuer));
	try {
		const { payload } = await jwtVerify(token, jwks, {
			issuer: config.auth0.issuer,
			audience: config.auth0.audience,
		});
		if (!payload.sub) throw new AuthError("Token has no subject.");
		return payload as JWTPayload & { sub: string };
	} catch (e) {
		throw e instanceof AuthError ? e : new AuthError(`Invalid token: ${(e as Error).message}`);
	}
}

/** Verifies the token and looks up the person's name and picture (cached). */
export async function identify(token: string): Promise<Identity> {
	const payload = await verifyToken(token);
	const sub = payload.sub;
	let profile = profiles.get(sub);
	if (!profile || Date.now() - profile.at > profileTtlMs) {
		profile = { at: Date.now(), ...(await fetchProfile(token, payload)) };
		profiles.set(sub, profile);
	}
	return { sub, provider: sub.split("|")[0] ?? "", name: profile.name, picture: profile.picture };
}

async function fetchProfile(token: string, payload: JWTPayload) {
	const claim = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : null);
	try {
		const res = await fetch(new URL("userinfo", config.auth0.issuer), {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(5000),
		});
		if (res.ok) {
			const info = (await res.json()) as Record<string, unknown>;
			const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
			return {
				name: str(info.nickname) ?? str(info.given_name) ?? str(info.name) ?? claim("name"),
				picture: str(info.picture) ?? claim("picture"),
			};
		}
	} catch {
		// fall back to whatever the token carries
	}
	return { name: claim("nickname") ?? claim("name"), picture: claim("picture") };
}

export function bearer(header: string | undefined): string | null {
	const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
	return match ? match[1].trim() : null;
}
