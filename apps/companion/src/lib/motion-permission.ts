import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { DeviceMotion } from "expo-sensors";

/**
 * Where motion access stands:
 * - checking:    asking the OS
 * - ask:         not granted yet; the app can show the system prompt
 * - blocked:     denied and the OS won't ask again; only Settings can fix it
 * - unavailable: no motion sensors (or a browser without them / without HTTPS)
 * - granted
 */
export type MotionAccess = "checking" | "ask" | "blocked" | "unavailable" | "granted";

async function check(): Promise<MotionAccess> {
	try {
		if (!(await DeviceMotion.isAvailableAsync())) return "unavailable";
		const permission = await DeviceMotion.getPermissionsAsync();
		if (permission.granted) return "granted";
		return permission.canAskAgain === false ? "blocked" : "ask";
	} catch {
		return "unavailable";
	}
}

/**
 * Motion access for the screens that need sensors. Checks when `active` turns on and
 * whenever the app comes back to the foreground (e.g. from the Settings app), and
 * `request()` shows the system prompt. Call `request` from a tap: browsers only allow
 * the prompt from a user gesture.
 */
export function useMotionAccess(active: boolean) {
	const [access, setAccess] = useState<MotionAccess>("checking");

	useEffect(() => {
		if (!active) return;
		let cancelled = false;
		const refresh = () => void check().then((next) => { if (!cancelled) setAccess(next); });
		refresh();
		const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
		return () => {
			cancelled = true;
			subscription.remove();
		};
	}, [active]);

	const request = useCallback(async () => {
		try {
			const permission = await DeviceMotion.requestPermissionsAsync();
			const next: MotionAccess = permission.granted ? "granted" : permission.canAskAgain === false ? "blocked" : "ask";
			setAccess(next);
			return next;
		} catch {
			setAccess("unavailable");
			return "unavailable" as const;
		}
	}, []);

	return { access, request };
}
