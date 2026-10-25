import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { apiGet, defaultApiUrl, type ApiConfig, type MyStats } from "./api";
import { storage } from "./storage";

// On the web, sign-in happens in a popup that comes back to /auth; this lets
// that page hand the result to the window that opened it and close.
WebBrowser.maybeCompleteAuthSession();

export type Provider = "google" | "github";

export type Profile = { sub: string; name: string; picture: string | null; provider: string };

type Session = {
	accessToken: string;
	refreshToken: string | null;
	/** ms since epoch */
	expiresAt: number;
	profile: Profile;
};

type AccountState = {
	apiUrl: string;
	setApiUrl: (url: string) => void;
	/** null while loading; `auth` is null when the server has no Auth0 set up. */
	config: ApiConfig | null;
	configError: string | null;
	profile: Profile | null;
	busy: boolean;
	error: string | null;
	signIn: (provider: Provider) => Promise<boolean>;
	signOut: () => Promise<void>;
	/** A current access token (refreshed if needed), or null if signed out. */
	accessToken: () => Promise<string | null>;
	/** The signed-in player's stats from the API. */
	myStats: () => Promise<MyStats>;
};

const AccountContext = createContext<AccountState | null>(null);

const keys = { session: "skillissue.session", apiUrl: "skillissue.apiUrl" };
const refreshEarlyMs = 60_000;

function discovery(auth: NonNullable<ApiConfig["auth"]>): AuthSession.DiscoveryDocument {
	const base = (auth.issuer || `https://${auth.domain}/`).replace(/\/+$/, "");
	return {
		authorizationEndpoint: `${base}/authorize`,
		tokenEndpoint: `${base}/oauth/token`,
		revocationEndpoint: `${base}/oauth/revoke`,
		userInfoEndpoint: `${base}/userinfo`,
	};
}

/** Where Auth0 sends the browser back: /auth on the website, companion://auth (or Expo Go's exp://…/--/auth) on phones. */
export const redirectUri = () => AuthSession.makeRedirectUri({ scheme: "companion", path: "auth" });

export function AccountProvider({ children }: { children: ReactNode }) {
	const [apiUrl, setApiUrlState] = useState(defaultApiUrl);
	const [config, setConfig] = useState<ApiConfig | null>(null);
	const [configError, setConfigError] = useState<string | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sessionRef = useRef<Session | null>(null);
	sessionRef.current = session;

	useEffect(() => {
		(async () => {
			const saved = await storage.get(keys.apiUrl);
			if (saved) setApiUrlState(saved);
			const raw = await storage.get(keys.session);
			if (raw) {
				try {
					setSession(JSON.parse(raw));
				} catch {
					await storage.set(keys.session, null);
				}
			}
		})();
	}, []);

	useEffect(() => {
		let cancelled = false;
		setConfig(null);
		setConfigError(null);
		apiGet<ApiConfig>(apiUrl, "/api/config").then(
			(c) => !cancelled && setConfig(c),
			(e) => !cancelled && setConfigError((e as Error).message)
		);
		return () => {
			cancelled = true;
		};
	}, [apiUrl]);

	const save = useCallback(async (next: Session | null) => {
		setSession(next);
		await storage.set(keys.session, next ? JSON.stringify(next) : null);
	}, []);

	const setApiUrl = useCallback((url: string) => {
		const clean = url.trim().replace(/\/+$/, "");
		setApiUrlState(clean);
		void storage.set(keys.apiUrl, clean || null);
	}, []);

	const clientId = config?.auth ? (Platform.OS === "web" ? config.auth.webClientId : config.auth.nativeClientId) : null;

	const signIn = useCallback(
		async (provider: Provider): Promise<boolean> => {
			setError(null);
			const auth = config?.auth;
			if (!auth || !clientId) {
				setError(configError ?? "Sign-in isn't set up on the server yet (Auth0).");
				return false;
			}
			setBusy(true);
			try {
				const docs = discovery(auth);
				const request = new AuthSession.AuthRequest({
					clientId,
					redirectUri: redirectUri(),
					scopes: ["openid", "profile", "email", "offline_access"],
					usePKCE: true,
					extraParams: { audience: auth.audience, connection: auth.connections[provider] },
				});
				const result = await request.promptAsync(docs);
				if (result.type !== "success") {
					if (result.type === "error") setError(result.error?.message ?? "Sign-in failed.");
					return false;
				}
				const tokens = await AuthSession.exchangeCodeAsync(
					{
						clientId,
						code: result.params.code,
						redirectUri: redirectUri(),
						extraParams: { code_verifier: request.codeVerifier ?? "" },
					},
					docs
				);
				const info = await AuthSession.fetchUserInfoAsync({ accessToken: tokens.accessToken }, docs).catch(() => ({}) as Record<string, string>);
				const sub = String(info.sub ?? "");
				await save({
					accessToken: tokens.accessToken,
					refreshToken: tokens.refreshToken ?? null,
					expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
					profile: {
						sub,
						name: String(info.nickname ?? info.given_name ?? info.name ?? "Player").slice(0, 16),
						picture: info.picture ? String(info.picture) : null,
						provider: sub.split("|")[0] || auth.connections[provider],
					},
				});
				// Creates the account on the server (or refreshes name and picture).
				apiGet(apiUrl, "/api/me", tokens.accessToken).catch(() => {});
				return true;
			} catch (e) {
				setError((e as Error).message || "Sign-in failed.");
				return false;
			} finally {
				setBusy(false);
			}
		},
		[apiUrl, clientId, config, configError, save]
	);

	const accessToken = useCallback(async (): Promise<string | null> => {
		const current = sessionRef.current;
		if (!current) return null;
		if (current.expiresAt - refreshEarlyMs > Date.now()) return current.accessToken;
		const auth = config?.auth;
		if (!current.refreshToken || !auth || !clientId) {
			await save(null);
			return null;
		}
		try {
			const tokens = await AuthSession.refreshAsync({ clientId, refreshToken: current.refreshToken }, discovery(auth));
			const next = {
				...current,
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken ?? current.refreshToken,
				expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
			};
			await save(next);
			return next.accessToken;
		} catch {
			await save(null);
			return null;
		}
	}, [clientId, config, save]);

	const signOut = useCallback(async () => {
		const current = sessionRef.current;
		const auth = config?.auth;
		await save(null);
		if (current?.refreshToken && auth && clientId) {
			AuthSession.revokeAsync({ clientId, token: current.refreshToken }, discovery(auth)).catch(() => {});
		}
	}, [clientId, config, save]);

	const myStats = useCallback(async () => {
		const token = await accessToken();
		if (!token) throw new Error("Sign in to see your stats.");
		return apiGet<MyStats>(apiUrl, "/api/me", token);
	}, [accessToken, apiUrl]);

	const value = useMemo<AccountState>(
		() => ({ apiUrl, setApiUrl, config, configError, profile: session?.profile ?? null, busy, error, signIn, signOut, accessToken, myStats }),
		[apiUrl, setApiUrl, config, configError, session, busy, error, signIn, signOut, accessToken, myStats]
	);
	return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
	const value = useContext(AccountContext);
	if (!value) throw new Error("useAccount() needs <AccountProvider> (app/_layout.tsx).");
	return value;
}
