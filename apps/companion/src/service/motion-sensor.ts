import { Platform } from "react-native";
import { Accelerometer, DeviceMotion, Gyroscope } from "expo-sensors";
import { androidMotionReading } from "@/lib/math/android-motion";
import type { MotionReading } from "@/types/motion";

/** Android avoids DeviceMotion's unrelated activity permission and five-sensor requirement. */
export const MotionSensor = {
	setUpdateInterval(milliseconds: number) {
		if (Platform.OS === "android") {
			Accelerometer.setUpdateInterval(milliseconds);
			Gyroscope.setUpdateInterval(milliseconds);
		} else DeviceMotion.setUpdateInterval(milliseconds);
	},
	addListener(listener: (reading: MotionReading) => void): { remove(): void } {
		if (Platform.OS !== "android") return DeviceMotion.addListener((reading) => {
			// Expo's browser event has no rotation object; debug views still expect one.
			listener({ ...reading, rotation: reading.rotation ?? { alpha: 0, beta: 0, gamma: 0 } });
		});
		let latest: Parameters<typeof androidMotionReading>[0] | null = null;
		let lastStamp = -Infinity;
		const accel = Accelerometer.addListener((reading) => { latest = reading; });
		let gyro: ReturnType<typeof Gyroscope.addListener>;
		try {
			gyro = Gyroscope.addListener((reading) => {
				if (!latest || reading.timestamp <= lastStamp) {
					// Sensor clocks can restart after the app resumes.
					if (reading.timestamp < lastStamp) lastStamp = -Infinity;
					return;
				}
				const sample = androidMotionReading(latest, reading);
				if (!sample) return;
				lastStamp = reading.timestamp;
				listener(sample);
			});
		} catch (error) { accel.remove(); throw error; }
		return { remove() { accel.remove(); gyro.remove(); } };
	},
};
