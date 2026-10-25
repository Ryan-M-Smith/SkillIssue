import type { Mat3 } from "@/lib/math/orientation";

export type Phone3DPose = {
	/** Phone frame -> player's world (x right, y away, z up). Null before calibration. */
	rotation: Mat3 | null;
};

export type Phone3DProps = {
	/** Called every animation frame; return the latest pose. */
	getPose: () => Phone3DPose;
	height?: number;
};
