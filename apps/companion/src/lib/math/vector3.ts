/** A generic 3D vector. */
export class Vector3 {
	constructor(
		public readonly x: number,
		public readonly y: number,
		public readonly z: number
	) {}

	static format(v: Pick<Vector3, "x" | "y" | "z">): string {
		return `<${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}>`;
	}

	format(): string {
		return Vector3.format(this);
	}
}

export const vec3Zero = new Vector3(0, 0, 0);

export const vec3Format = (v: Pick<Vector3, "x" | "y" | "z">): string => {
	return Vector3.format(v);
};