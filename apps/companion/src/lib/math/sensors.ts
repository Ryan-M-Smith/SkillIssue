import { Vector3, vec3Zero } from "./vector3";

export function average(readings: Vector3[]): Vector3 {
	const samples = readings.length || 1;
	
	const sum = readings.reduce((acc, vec) => (
		new Vector3(
			acc.x + vec.x,
			acc.y + vec.y,
			acc.z + vec.z
		)
	), vec3Zero);

	return new Vector3(
		sum.x / samples,
		sum.y / samples,
		sum.z / samples
	);
};