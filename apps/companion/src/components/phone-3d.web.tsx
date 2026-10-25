import { useEffect, useRef } from "react";

import type { MotionVector } from "@/types/motion";
import type { Mat3 } from "@/lib/math/orientation";
import type { Phone3DProps } from "./phone-3d.types";

export type { Phone3DPose, Phone3DProps } from "./phone-3d.types";

const palette = {
	bg: "#121A2C",
	grid: "#26334F",
	body: "#2B3550",
	edge: "#46557A",
	screen: "#0D1424",
	top: "#57AAFF",
	pitch: "#3987E5",
	side: "#D95926",
	twist: "#199E70",
	gravity: "#99AAC6",
	text: "#C3CEE3",
	muted: "#8D9CB8",
};

// Phone size in metres, in its own frame: X short side, Y long side, Z out of the screen.
const half = { x: 0.0375, y: 0.08, z: 0.0045 };

type V = MotionVector;
const v = (x: number, y: number, z: number): V => ({ x, y, z });
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: V, k: number): V => v(a.x * k, a.y * k, a.z * k);
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a: V) => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const apply = (m: Mat3, p: V): V => v(dot(m[0], p), dot(m[1], p), dot(m[2], p));

// Camera: where the player's eyes are, behind and above the phone.
const eye = v(0, -0.3, 0.17);
const target = v(0, 0, 0);
const camF = norm(sub(target, eye));
const camR = norm(cross(camF, v(0, 0, 1)));
const camU = cross(camR, camF);
const fov = (38 * Math.PI) / 180;

const faces: { normal: V; corners: [number, number, number][] }[] = [
	{ normal: v(0, 0, 1), corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
	{ normal: v(0, 0, -1), corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
	{ normal: v(1, 0, 0), corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
	{ normal: v(-1, 0, 0), corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
	{ normal: v(0, 1, 0), corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
	{ normal: v(0, -1, 0), corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

function shade(hex: string, k: number) {
	const n = parseInt(hex.slice(1), 16);
	const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
	return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, rotation: Mat3 | null) {
	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = palette.bg;
	ctx.fillRect(0, 0, w, h);

	const focal = h / 2 / Math.tan(fov / 2);
	const project = (p: V) => {
		const d = sub(p, eye);
		const z = dot(d, camF);
		return { x: w / 2 + (dot(d, camR) / z) * focal, y: h / 2 - (dot(d, camU) / z) * focal, z };
	};
	const line = (a: V, b: V, color: string, width = 1, dash: number[] = []) => {
		const pa = project(a), pb = project(b);
		ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
		ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
		ctx.setLineDash([]);
	};
	const arrow = (from: V, dir: V, length: number, color: string, label: string) => {
		const to = add(from, mul(dir, length));
		line(from, to, color, 2.5);
		const pa = project(add(from, mul(dir, length * 0.82))), pb = project(to);
		const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(pb.x, pb.y);
		ctx.lineTo(pb.x - 10 * Math.cos(ang - 0.4), pb.y - 10 * Math.sin(ang - 0.4));
		ctx.lineTo(pb.x - 10 * Math.cos(ang + 0.4), pb.y - 10 * Math.sin(ang + 0.4));
		ctx.closePath(); ctx.fill();
		ctx.fillStyle = palette.text;
		ctx.font = "12px ui-monospace, Menlo, monospace";
		ctx.fillText(label, pb.x + 6, pb.y - 4);
	};

	// floor grid
	for (let i = -5; i <= 5; i++) {
		line(v(i * 0.05, -0.25, -0.12), v(i * 0.05, 0.25, -0.12), palette.grid);
		line(v(-0.25, i * 0.05, -0.12), v(0.25, i * 0.05, -0.12), palette.grid);
	}

	// the model's fixed player axes
	arrow(v(-0.12, 0, 0), v(1, 0, 0), 0.24, palette.pitch, "pitch axis");
	arrow(v(0, -0.12, 0), v(0, 1, 0), 0.24, palette.side, "side axis");
	arrow(v(0, 0, 0), v(0, 0, -1), 0.1, palette.gravity, "gravity");

	if (!rotation) {
		ctx.fillStyle = palette.muted;
		ctx.font = "14px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("Waiting for the phone to calibrate. Hold it still.", w / 2, h - 24);
		ctx.textAlign = "start";
		return;
	}

	// phone box, back to front
	const world = (c: [number, number, number]) => apply(rotation, v(c[0] * half.x, c[1] * half.y, c[2] * half.z));
	const light = norm(v(0.3, -0.5, 0.8));
	const drawn = faces
		.map((f) => {
			const pts = f.corners.map(world);
			const n = apply(rotation, f.normal);
			const center = mul(pts.reduce(add), 0.25);
			return { f, pts, n, depth: project(center).z, facing: dot(n, sub(eye, center)) > 0 };
		})
		.filter((d) => d.facing)
		.sort((a, b) => b.depth - a.depth);

	for (const d of drawn) {
		const isScreen = d.f.normal.z === 1;
		const k = 0.55 + 0.45 * Math.max(0, dot(d.n, light));
		ctx.fillStyle = shade(isScreen ? palette.screen : palette.body, isScreen ? 1 : k);
		ctx.strokeStyle = palette.edge; ctx.lineWidth = 1;
		ctx.beginPath();
		d.pts.map(project).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
		ctx.closePath(); ctx.fill(); ctx.stroke();

		if (isScreen) {
			// top-of-phone marker, so the grip is readable
			const a = world([-0.4, 0.9, 1.05]), b = world([0.4, 0.9, 1.05]);
			line(a, b, palette.top, 4);
			const label = project(world([0, 0.72, 1.05]));
			ctx.fillStyle = palette.top; ctx.font = "11px ui-monospace, Menlo, monospace"; ctx.textAlign = "center";
			ctx.fillText("TOP", label.x, label.y);
			ctx.textAlign = "start";
		}
	}

	// twist axis rides with the phone (its screen normal)
	arrow(v(0, 0, 0), apply(rotation, v(0, 0, 1)), 0.08, palette.twist, "twist (Z)");
}

/** Live 3D view of the phone, drawn on a canvas. */
export default function Phone3D({ getPose, height = 360 }: Phone3DProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const poseRef = useRef(getPose);

	useEffect(() => {
		poseRef.current = getPose;
	}, [getPose]);

	useEffect(() => {
		let frame = 0;
		const loop = () => {
			const canvas = canvasRef.current;
			if (canvas) {
				const dpr = Math.min(window.devicePixelRatio || 1, 2);
				const w = canvas.clientWidth, h = canvas.clientHeight;
				if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
					canvas.width = Math.round(w * dpr);
					canvas.height = Math.round(h * dpr);
				}
				const ctx = canvas.getContext("2d");
				if (ctx && w && h) {
					ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
					draw(ctx, w, h, poseRef.current().rotation);
				}
			}
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	}, []);

	return (
		<canvas
			ref={canvasRef}
			aria-label="3D view of the phone as the motion model sees it"
			style={{ width: "100%", height, display: "block", borderRadius: 10 }}
		/>
	);
}
