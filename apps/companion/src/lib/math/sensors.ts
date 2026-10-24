import { Vector3, vec3Zero } from "./vector3";

export function average(readings: Vector3[]): Vector3 {
	const sum = readings.reduce((acc, vec) => (
		new Vector3(
			acc.x + vec.x,
			acc.y + vec.y,
			acc.z + vec.z
		)
	), vec3Zero);

	return new Vector3(
		sum.x / readings.length,
		sum.y / readings.length,
		sum.z / readings.length
	);
};