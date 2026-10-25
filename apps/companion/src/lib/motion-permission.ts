import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { Accelerometer, DeviceMotion, Gyroscope } from "expo-sensors";
import { resolveMotionAccess, type MotionAccess } from "./motion-access-policy";
export type { MotionAccess } from "./motion-access-policy";

/**
 * Where motion access stands:
 * - checking:    asking the OS
 * - ask:         not granted yet; the app can show the system prompt
 * - blocked:     denied and the OS won't ask again; only Settings can fix it
 * - unavailable: no motion sensors (or a browser without them / without HTTPS)
 * - granted
 */
const sensors = {
	accelerometerAvailable: () => Accelerometer.isAvailableAsync(),
	gyroscopeAvailable: () => Gyroscope.isAvailableAsync(),
	motionAvailable: () => DeviceMotion.isAvailableAsync(),
	getPermission: () => DeviceMotion.getPermissionsAsync(),
	requestPermission: () => DeviceMotion.requestPermissionsAsync(),
};

export const requestMotionAccess = () => resolveMotionAccess(Platform.OS, true, sensors);

async function check(): Promise<MotionAccess> {
	return resolveMotionAccess(Platform.OS, false, sensors);
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
			const next = await requestMotionAccess();
			setAccess(next);
			return next;
		} catch {
			setAccess("unavailable");
			return "unavailable" as const;
		}
	}, []);

	return { access, request };
}
