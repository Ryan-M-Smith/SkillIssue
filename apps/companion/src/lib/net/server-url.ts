import Constants from "expo-constants";
import { Platform } from "react-native";

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
	if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
		return `ws://${window.location.hostname}:${debugServerPort}`;
	}

	const hostUri = Constants.expoConfig?.hostUri ?? "";
	const host = hostUri.split(":")[0];

	if (host && !host.endsWith("exp.direct")) {
		return `ws://${host}:${debugServerPort}`;
	}

	return `ws://192.168.1.2:${debugServerPort}`;
}
