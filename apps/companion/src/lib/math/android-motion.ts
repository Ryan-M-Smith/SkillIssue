import type { MotionReading, MotionVector } from "@/types/motion";
import { radToDeg } from "./motion";

type Sample = MotionVector & { timestamp: number };

/** Raw Expo accelerometer = g, gyro = rad/s; controller = gravity-down m/s², deg/s. */
export function androidMotionReading(accel: Sample, gyro: Sample): MotionReading | null {
	if (![accel.x, accel.y, accel.z, gyro.x, gyro.y, gyro.z, accel.timestamp, gyro.timestamp].every(Number.isFinite)) return null;
	if (Math.abs(accel.timestamp - gyro.timestamp) > 0.25 || Math.hypot(accel.x, accel.y, accel.z) < 0.05) return null;
	return {
		timestamp: gyro.timestamp,
		rotation: { alpha: 0, beta: 0, gamma: 0, timestamp: gyro.timestamp },
		rotationRate: { alpha: radToDeg(gyro.x), beta: radToDeg(gyro.y), gamma: radToDeg(gyro.z), timestamp: gyro.timestamp },
		acceleration: null,
		accelerationIncludingGravity: { x: -accel.x * 9.80665, y: -accel.y * 9.80665, z: -accel.z * 9.80665, timestamp: accel.timestamp },
	};
}
