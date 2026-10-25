import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Load apps/api/.env if present (KEY=value lines), without overriding real env vars.
try {
	for (const line of readFileSync(resolve(here, "../.env"), "utf8").split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (match && process.env[match[1]] === undefined) {
			process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
		}
	}
} catch {
	// no .env: use the environment as is
}

const env = (name: string) => process.env[name]?.trim() || "";

const auth0Domain = env("AUTH0_DOMAIN").replace(/^https?:\/\//, "").replace(/\/+$/, "");

export const config = {
	port: Number(env("PORT") || 3000),
	/** Tiger Cloud connection string (Postgres URL). */
	databaseUrl: env("DATABASE_URL"),
	auth0: {
		domain: auth0Domain,
		/** Token issuer. Defaults to https://<domain>/; override only for tests. */
		issuer: env("AUTH0_ISSUER") || (auth0Domain ? `https://${auth0Domain}/` : ""),
		/** The API identifier set up in Auth0 (tokens must be issued for it). */
		audience: env("AUTH0_AUDIENCE"),
		/** Public client ids, handed to the website, phone app and game by /api/config. */
		webClientId: env("AUTH0_WEB_CLIENT_ID"),
		nativeClientId: env("AUTH0_NATIVE_CLIENT_ID"),
	},
	/** Built website (npx expo export -p web in apps/companion). Served at /. */
	webDir: resolve(here, "..", env("WEB_DIR") || "../companion/dist"),
	/** Comma-separated origins allowed to call the API from a browser. Empty = any. */
	corsOrigins: env("CORS_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean),
};

export const authEnabled = () => !!(config.auth0.issuer && config.auth0.audience);
