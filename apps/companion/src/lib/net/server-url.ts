import Constants from "expo-constants";

export const debugServerPort = 8080;
export const defaultDebugRoom = "debug";

/**
 * Best guess at the SkillIssue server's address.
 * Web: the computer serving this page. Phone: the computer running the Expo
 * dev server (its LAN address), which is usually where the server runs too.
 * Tunnelled dev servers (exp.direct) can't be reached this way; type the
 * computer's LAN address instead (the server prints it on startup).
 */
export function defaultDebugServerUrl(): string {
	const configured = process.env.EXPO_PUBLIC_GAME_SERVER;
	if (configured) return configured;
	const hostUri = Constants.expoConfig?.hostUri ?? "";
	let host = "";
	try {
		host = new URL(`http://${hostUri}`).hostname;
	} catch {
		// A release build or Expo tunnel may have no reachable LAN host.
	}

	if (host && !host.endsWith("exp.direct")) {
		return `ws://${host}:${debugServerPort}`;
	}

	return "";
}
