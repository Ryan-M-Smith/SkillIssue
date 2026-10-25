// Sets up Auth0 for SkillIssue in one go, through the Management API:
//   - the "SkillIssue API" (the audience every token is issued for)
//   - "SkillIssue Web" (single-page app: the website)
//   - "SkillIssue Native" (native app: the phone app and the Godot game)
//   - Google and GitHub logins, switched on for both apps
// Then writes the ids to apps/api/.env. Safe to run again: it updates what exists.
//
// Needs (env or apps/api/.env):
//   AUTH0_DOMAIN          your-tenant.us.auth0.com
//   AUTH0_MGMT_TOKEN      Dashboard → Applications → APIs → Auth0 Management API → API Explorer → copy token
//     (or AUTH0_MGMT_CLIENT_ID + AUTH0_MGMT_CLIENT_SECRET of a machine-to-machine app)
//   SITE_URL              https://your-domain (the website, once it's live; optional)
// Optional: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   (without them Auth0's development keys are used: fine for a demo, not for launch).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "../src/config.ts"; // loads apps/api/.env into process.env

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
const env = (k: string) => process.env[k]?.trim() ?? "";

const domain = env("AUTH0_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const audience = env("AUTH0_AUDIENCE") || "https://api.skillissue.game";
const site = env("SITE_URL").replace(/\/+$/, "");
const gameCallback = "http://127.0.0.1:7350/callback";

if (!domain) fail("Set AUTH0_DOMAIN (e.g. your-tenant.us.auth0.com).");

const token = await managementToken();
const api = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
	const res = await fetch(`https://${domain}/api/v2${path}`, {
		method,
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
	return (text ? JSON.parse(text) : null) as T;
};

// 1. The API (audience)
const servers = await api<any[]>("GET", "/resource-servers");
let server = servers.find((s) => s.identifier === audience);
const serverSettings = { signing_alg: "RS256", allow_offline_access: true, token_lifetime: 86_400, skip_consent_for_verifiable_first_party_clients: true };
if (server) {
	await api("PATCH", `/resource-servers/${server.id}`, serverSettings);
	step(`API "${server.name}" (${audience}) already there, updated`);
} else {
	server = await api("POST", "/resource-servers", { name: "SkillIssue API", identifier: audience, ...serverSettings });
	step(`Created API "SkillIssue API" (${audience})`);
}

// 2. The two applications
const local = ["http://localhost:8081", "http://localhost:3000", "http://127.0.0.1:3000"];
const origins = [...(site ? [site] : []), ...local];
const rotating = { rotation_type: "rotating", expiration_type: "expiring", token_lifetime: 2_592_000, idle_token_lifetime: 1_296_000, leeway: 0, infinite_token_lifetime: false, infinite_idle_token_lifetime: false };
const web = await upsertClient("SkillIssue Web", {
	app_type: "spa",
	callbacks: origins.map((o) => `${o}/auth`),
	allowed_logout_urls: origins,
	web_origins: origins,
	allowed_origins: origins,
});
const native = await upsertClient("SkillIssue Native", {
	app_type: "native",
	// The Godot game's local callback, the phone app (development build), and Expo Go
	// (add your own exp://<computer-ip>:8081/--/auth: the app shows it under Settings).
	callbacks: [gameCallback, "companion://auth", ...env("EXTRA_NATIVE_CALLBACKS").split(",").map((s) => s.trim()).filter(Boolean)],
	allowed_logout_urls: ["companion://auth"],
});

async function upsertClient(name: string, settings: Record<string, unknown> & { app_type: string }) {
	const all = await api<any[]>("GET", "/clients?fields=client_id,name,callbacks,web_origins,allowed_origins,allowed_logout_urls&include_fields=true");
	const common = {
		...settings,
		oidc_conformant: true,
		token_endpoint_auth_method: "none",
		grant_types: ["authorization_code", "refresh_token"],
		refresh_token: rotating,
		jwt_configuration: { alg: "RS256" },
	};
	const existing = all.find((c) => c.name === name);
	if (existing) {
		// Keep any URLs added by hand in the dashboard.
		const merge = (key: string) => [...new Set([...(existing[key] ?? []), ...((settings[key] as string[]) ?? [])])];
		const rest: Record<string, unknown> = { ...common };
		delete rest.app_type; // can't change an app's type
		await api("PATCH", `/clients/${existing.client_id}`, {
			...rest,
			callbacks: merge("callbacks"),
			allowed_logout_urls: merge("allowed_logout_urls"),
			...(settings.web_origins ? { web_origins: merge("web_origins"), allowed_origins: merge("allowed_origins") } : {}),
		});
		step(`App "${name}" already there, updated (${existing.client_id})`);
		return existing.client_id as string;
	}
	const created = await api("POST", "/clients", { name, ...common });
	step(`Created app "${name}" (${created.client_id})`);
	return created.client_id as string;
}

// 3. Google and GitHub, on for both apps
for (const [strategy, label, idKey, secretKey] of [
	["google-oauth2", "Google", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
	["github", "GitHub", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
] as const) {
	const keys = env(idKey) && env(secretKey) ? { client_id: env(idKey), client_secret: env(secretKey) } : {};
	const options = strategy === "github" ? { ...keys, profile: true, email: true } : { ...keys, profile: true, email: true };
	const found = await api<any[]>("GET", `/connections?strategy=${strategy}`);
	let connection = found[0];
	if (!connection) {
		connection = await api("POST", "/connections", { name: strategy, strategy, options });
		step(`Created the ${label} login${keys.client_id ? "" : " (Auth0 development keys)"}`);
	} else if (keys.client_id) {
		await api("PATCH", `/connections/${connection.id}`, { options: { ...connection.options, ...options } });
		step(`${label} login already there, set its OAuth keys`);
	} else {
		step(`${label} login already there`);
	}
	await enableConnection(connection, [web, native]);
	step(`  ${label} switched on for SkillIssue Web and SkillIssue Native`);
}

async function enableConnection(connection: any, clientIds: string[]) {
	try {
		// Current API: PATCH /connections/{id}/clients
		await api("PATCH", `/connections/${connection.id}/clients`, clientIds.map((client_id) => ({ client_id, status: true })));
	} catch {
		// Older tenants: enabled_clients on the connection
		const enabled = [...new Set([...(connection.enabled_clients ?? []), ...clientIds])];
		await api("PATCH", `/connections/${connection.id}`, { enabled_clients: enabled });
	}
}

// 4. Save the settings the API hands to the website, app and game
const values: Record<string, string> = {
	AUTH0_DOMAIN: domain,
	AUTH0_AUDIENCE: audience,
	AUTH0_WEB_CLIENT_ID: web,
	AUTH0_NATIVE_CLIENT_ID: native,
};
let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(values)) {
	const line = `${k}=${v}`;
	text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
}
writeFileSync(envPath, text.replace(/^\n/, ""));
step(`Wrote ${Object.keys(values).join(", ")} to apps/api/.env`);
console.log("\nDone. Restart the API (npm run api:start); the website, phone app and game read these from /api/config.");
if (!site) console.log("When the website has its domain, run this again with SITE_URL=https://your-domain to allow it.");

// ---------------------------------------------------------------- helpers

async function managementToken(): Promise<string> {
	if (env("AUTH0_MGMT_TOKEN")) return env("AUTH0_MGMT_TOKEN");
	const id = env("AUTH0_MGMT_CLIENT_ID");
	const secret = env("AUTH0_MGMT_CLIENT_SECRET");
	if (!id || !secret) {
		fail("Set AUTH0_MGMT_TOKEN (Dashboard → Applications → APIs → Auth0 Management API → API Explorer), or AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET.");
	}
	const res = await fetch(`https://${domain}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret, audience: `https://${domain}/api/v2/` }),
	});
	const body = await res.json();
	if (!res.ok) fail(`Couldn't get a Management API token: ${body.error_description ?? res.status}`);
	return body.access_token;
}

function step(text: string) {
	console.log(`✓ ${text}`);
}

function fail(text: string): never {
	console.error(`✗ ${text}`);
	process.exit(1);
}
