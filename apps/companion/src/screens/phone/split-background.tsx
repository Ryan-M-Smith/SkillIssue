import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ui } from "./theme";

const blue = (a: number) => `rgba(59, 140, 255, ${a})`;
const red = (a: number) => `rgba(255, 74, 74, ${a})`;
const base = (a: number) => `rgba(7, 10, 18, ${a})`;

const stripeGap = 46;       // px between stripes
const stripeWidth = 3;
const stripeLoopMs = 4200;  // one stripe gap per loop: they flow away from the seam
const breatheMs = 5200;     // the seam sways and its glow pulses

/** Glow bands on each side of the seam, nearest first: [width px, team alpha]. */
const glow: [number, number][] = [[6, 0.3], [16, 0.16], [32, 0.1], [60, 0.07], [110, 0.05], [190, 0.035], [300, 0.025]];
/** How far from the seam the backdrop fades back to the base color: [from px, alpha]. */
const fade: [number, number][] = [[110, 0.1], [170, 0.2], [240, 0.3], [320, 0.4], [410, 0.5], [520, 0.6], [650, 0.68]];

/**
 * The game's menu background (apps/game/ui/ui_kit.gd BACKGROUND_SHADER) for the phone:
 * blue | red halves meeting at a tilted, glowing seam that sways, diagonal stripes that
 * flow away from it on each side, and tints that fade with distance.
 * Built from animated views (native driver), so it runs in Expo Go without a shader.
 * It reaches past the safe-area padding to the screen's edges; controls stay inside.
 * Still when the phone's Reduce Motion setting is on.
 */
export function SplitBackground({ split = 0.5 }: { split?: number }) {
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const [flow] = useState(() => new Animated.Value(0));
	const [breathe] = useState(() => new Animated.Value(0));
	const [still, setStill] = useState(false);

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
		const loops = Animated.parallel([
			Animated.loop(Animated.timing(flow, { toValue: 1, duration: stripeLoopMs, easing: Easing.linear, useNativeDriver: true })),
			Animated.loop(Animated.sequence([
				Animated.timing(breathe, { toValue: 1, duration: breatheMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
				Animated.timing(breathe, { toValue: 0, duration: breatheMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
			])),
		]);
		loops.start();
		return () => loops.stop();
	}, [still, flow, breathe]);

	// Same slant as the game: the seam moves 0.28 of the width from top to bottom ("\").
	const angle = -(Math.atan((0.28 * width) / Math.max(1, height)) * 180) / Math.PI;
	const sway = breathe.interpolate({ inputRange: [0, 1], outputRange: [`${angle - 1.2}deg`, `${angle + 1.2}deg`] });
	const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
	const span = Math.hypot(width, height) * 1.6; // covers the screen at any slant
	const stripes = Math.ceil(span / stripeGap) + 2;
	const outLeft = flow.interpolate({ inputRange: [0, 1], outputRange: [0, -stripeGap] });
	const outRight = flow.interpolate({ inputRange: [0, 1], outputRange: [0, stripeGap] });

	const side = (dir: -1 | 1) => {
		const tint = dir < 0 ? blue : red;
		const at = (offset: number, w: number) => (dir < 0 ? { left: -offset - w, width: w } : { left: offset, width: w });
		return (
			<>
				<View style={[styles.band, at(0, span), { backgroundColor: tint(0.1) }]} />
				{/* Stripes, slanted against the seam, flowing outward. */}
				<View style={[styles.band, at(0, span), { overflow: "hidden" }]}>
					<Animated.View
						style={[
							styles.stripes,
							{ left: -stripeGap, width: span + stripeGap * 2, transform: [{ translateX: dir < 0 ? outLeft : outRight }, { skewX: `${dir * 22}deg` }] },
						]}
					>
						{Array.from({ length: stripes }, (_, i) => (
							<View key={i} style={{ width: stripeWidth, marginRight: stripeGap - stripeWidth, backgroundColor: tint(0.09) }} />
						))}
					</Animated.View>
				</View>
				{/* Glow hugging the seam. */}
				<Animated.View style={[StyleSheet.absoluteFill, { opacity: glowOpacity }]}>
					{glow.map(([w, a]) => (
						<View key={w} style={[styles.band, at(0, w), { backgroundColor: tint(a) }]} />
					))}
				</Animated.View>
				{/* Fade back to the base color farther out. */}
				{fade.map(([from, a], i) => {
					const to = fade[i + 1]?.[0] ?? span;
					return <View key={from} style={[styles.band, at(from, to - from), { backgroundColor: base(a) }]} />;
				})}
			</>
		);
	};

	return (
		<View
			style={[StyleSheet.absoluteFill, { top: -insets.top, bottom: -insets.bottom, left: -insets.left, right: -insets.right, overflow: "hidden", backgroundColor: ui.bg }]}
			pointerEvents="none"
		>
			<Animated.View
				style={[
					styles.seam,
					{ left: split * (width + insets.left + insets.right), top: -span / 2 + height / 2, height: span, transform: [{ rotate: sway }] },
				]}
			>
				{side(-1)}
				{side(1)}
				<Animated.View style={[styles.core, { opacity: glowOpacity }]} />
				<View style={styles.coreSoft} />
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	seam: { position: "absolute", width: 0 },
	band: { position: "absolute", top: 0, bottom: 0 },
	stripes: { position: "absolute", top: 0, bottom: 0, flexDirection: "row" },
	core: { position: "absolute", top: 0, bottom: 0, left: -1, width: 2, backgroundColor: "rgba(255, 255, 255, 0.9)" },
	coreSoft: { position: "absolute", top: 0, bottom: 0, left: -4, width: 8, backgroundColor: "rgba(255, 255, 255, 0.12)" },
});
