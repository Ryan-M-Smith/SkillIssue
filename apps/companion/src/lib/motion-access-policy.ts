export type MotionAccess = "checking" | "ask" | "blocked" | "unavailable" | "granted";
type Permission = { granted: boolean; canAskAgain?: boolean };
export type MotionPermissionSensors = {
	accelerometerAvailable: () => Promise<boolean>;
	gyroscopeAvailable: () => Promise<boolean>;
	motionAvailable: () => Promise<boolean>;
	getPermission: () => Promise<Permission>;
	requestPermission: () => Promise<Permission>;
};

/** Android raw motion sensors do not require ACTIVITY_RECOGNITION. */
export async function resolveMotionAccess(platform: string, request: boolean, sensors: MotionPermissionSensors): Promise<MotionAccess> {
	try {
		if (platform === "android") {
			const [accel, gyro] = await Promise.all([sensors.accelerometerAvailable(), sensors.gyroscopeAvailable()]);
			return accel && gyro ? "granted" : "unavailable";
		}
		// Safari must request permission before probing availability, directly from a tap.
		const permission = await (request ? sensors.requestPermission() : sensors.getPermission());
		if (!permission.granted) return permission.canAskAgain === false ? "blocked" : "ask";
		return await sensors.motionAvailable() ? "granted" : "unavailable";
	} catch {
		return "unavailable";
	}
}
