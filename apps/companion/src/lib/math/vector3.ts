/** A generic 3D vector. */
export class Vector3 {
	constructor(
		public readonly x: number,
		public readonly y: number,
		public readonly z: number
	) {}

	static zero(): Vector3 {
		return new Vector3(0, 0, 0);
	}

	static one(): Vector3 {
		return new Vector3(1, 1, 1);
	}

	static format(v: Pick<Vector3, "x" | "y" | "z">): string {
		return `<${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}>`;
	}

	format(): string {
		return Vector3.format(this);
	}
}
