import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ui } from "./theme";

const brickW = 64;
const brickH = 24;
const mortar = 3;
/** Concentric soft rings that fake a spotlight on the wall: [radius as a share of the screen, alpha]. */
const spot: [number, number][] = [[0.95, 0.018], [0.78, 0.02], [0.62, 0.024], [0.48, 0.028], [0.36, 0.032], [0.26, 0.036], [0.18, 0.04]];
/** Darkening bands toward every edge (vignette): [thickness px, alpha]. */
const edge: [number, number][] = [[140, 0.18], [90, 0.2], [50, 0.24], [22, 0.3]];

/** Deterministic 0..1 per brick, so the wall doesn't change between renders. */
const hash = (x: number, y: number) => {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
	return s - Math.floor(s);
};

/**
 * The game's menu backdrop (apps/game/ui/ui_kit.gd BACKGROUND_SHADER) for the phone, in the
 * film-noir style: a dark brick wall under one spotlight, a heavy vignette, a slight film
 * flicker, and a faint blue | red glow along the bottom edge (`split` moves where blue turns
 * to red). Plain views (native driver), so it runs in Expo Go without a shader. It reaches
 * past the safe-area padding to the screen's edges; controls stay inside. Still when the
 * phone's Reduce Motion setting is on. (Name kept so every screen keeps working.)
 */
export function SplitBackground({ split = 0.5 }: { split?: number }) {
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const [flicker] = useState(() => new Animated.Value(1));
	const [still, setStill] = useState(false);
	const w = width + insets.left + insets.right;
	const h = height + insets.top + insets.bottom;

	useEffect(() => {
		let cancelled = false;
		AccessibilityInfo.isReduceMotionEnabled().then((on) => !cancelled && setStill(on), () => {});
		const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
		return () => {
			cancelled = true;
			sub.remove();
		};
	}, []);

	useEffect(() => {
		if (still) return;
		// an old projector: the light dips a little now and then
		const step = (to: number, ms: number) => Animated.timing(flicker, { toValue: to, duration: ms, easing: Easing.linear, useNativeDriver: true });
		const loop = Animated.loop(Animated.sequence([
			step(0.93, 80), step(1, 120), Animated.delay(1900), step(0.96, 60), step(1, 90), Animated.delay(2600), step(0.9, 70), step(0.98, 60), step(1, 140), Animated.delay(1400),
		]));
		loop.start();
		return () => loop.stop();
	}, [still, flicker]);

	const bricks = useMemo(() => {
		const out: { x: number; y: number; a: number }[] = [];
		const rows = Math.ceil(h / brickH) + 1;
		const cols = Math.ceil(w / brickW) + 2;
		for (let r = 0; r < rows; r++) {
			const off = r % 2 ? brickW / 2 : 0;
			for (let c = -1; c < cols; c++) {
				out.push({ x: c * brickW - off, y: r * brickH, a: 0.035 + hash(c, r) * 0.05 });
			}
		}
		return out;
	}, [w, h]);

	const cx = w * 0.38;
	const cy = h * 0.3;
	const size = Math.max(w, h);
	return (
		<View style={[StyleSheet.absoluteFill, { top: -insets.top, bottom: -insets.bottom, left: -insets.left, right: -insets.right, overflow: "hidden", backgroundColor: ui.bg }]} pointerEvents="none">
			{/* the wall */}
			{bricks.map((b, i) => (
				<View key={i} style={{ position: "absolute", left: b.x, top: b.y, width: brickW - mortar, height: brickH - mortar, backgroundColor: `rgba(255, 255, 255, ${b.a.toFixed(3)})` }} />
			))}
			{/* one hard spotlight, flickering slightly */}
			<Animated.View style={[StyleSheet.absoluteFill, { opacity: flicker }]}>
				{spot.map(([r, a]) => {
					const d = size * r * 2;
					return <View key={r} style={{ position: "absolute", left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: d / 2, backgroundColor: `rgba(255, 252, 244, ${a})` }} />;
				})}
			</Animated.View>
			{/* faint team glow along the bottom: blue on the left, red on the right */}
			{[[34, 0.05], [18, 0.07], [8, 0.1]].map(([t, a]) => (
				<View key={t} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: t, flexDirection: "row" }}>
					<View style={{ flex: split, backgroundColor: `rgba(59, 140, 255, ${a})` }} />
					<View style={{ flex: 1 - split, backgroundColor: `rgba(255, 74, 74, ${a})` }} />
				</View>
			))}
			{/* heavy vignette */}
			{edge.map(([t, a]) => (
				<View key={`e${t}`} style={StyleSheet.absoluteFill}>
					<View style={{ position: "absolute", left: 0, right: 0, top: 0, height: t, backgroundColor: `rgba(0, 0, 0, ${a})` }} />
					<View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: t, backgroundColor: `rgba(0, 0, 0, ${a})` }} />
					<View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: t * 1.4, backgroundColor: `rgba(0, 0, 0, ${a})` }} />
					<View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: t * 1.4, backgroundColor: `rgba(0, 0, 0, ${a})` }} />
				</View>
			))}
		</View>
	);
}
