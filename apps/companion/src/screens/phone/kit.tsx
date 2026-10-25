import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { fonts, ui } from "./theme";

export { SplitBackground } from "./split-background";

/**
 * Display type. `depth` > 0 gives old-movie title lettering: a gray extrusion going
 * down-right behind the face (depth is a fraction of the font size, ~0.1 looks right).
 */
export function Title({ children, size = 34, color = ui.ink, style, depth = 0 }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle>; depth?: number }) {
	const base: TextStyle = { fontFamily: fonts.display, fontSize: size, color, letterSpacing: 0.5 };
	if (depth <= 0) return <Text style={[base, style]}>{children}</Text>;
	const layers = Math.max(2, Math.round(size * depth));
	return (
		<View style={{ paddingRight: layers, paddingBottom: layers }}>
			{Array.from({ length: layers }, (_, i) => {
				const k = layers - i;
				const g = Math.round(18 + (1 - k / layers) * 66);
				return (
					<Text key={k} accessible={false} importantForAccessibility="no" style={[base, style, styles.layer, { left: k * 0.75, top: k, color: `rgb(${g}, ${g}, ${g})` }]}>
						{children}
					</Text>
				);
			})}
			<Text style={[base, style]}>{children}</Text>
		</View>
	);
}

/** Title-card script, for small lines like "presents" or "vs.". */
export function Script({ children, size = 20, color = ui.muted }: { children: ReactNode; size?: number; color?: string }) {
	return <Text style={{ fontFamily: fonts.script, fontSize: size, color }}>{children}</Text>;
}

export function Eyebrow({ children, color = ui.muted }: { children: ReactNode; color?: string }) {
	return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

export function Body({ children, color = ui.ink, size = 15, style }: { children: ReactNode; color?: string; size?: number; style?: StyleProp<TextStyle> }) {
	return <Text style={[{ fontFamily: fonts.body, fontSize: size, color, lineHeight: size * 1.3 }, style]}>{children}</Text>;
}

/** The game's flat noir button (name kept for callers). `primary` = off-white slab. `color` = custom fill. */
export function SlantButton({
	label,
	onPress,
	primary = false,
	color,
	disabled = false,
	small = false,
	style,
	onPressIn,
	onPressOut,
}: {
	label: string;
	onPress?: () => void;
	primary?: boolean;
	color?: string;
	disabled?: boolean;
	small?: boolean;
	style?: StyleProp<ViewStyle>;
	onPressIn?: () => void;
	onPressOut?: () => void;
}) {
	const fill = color ?? (primary ? ui.ink : ui.panel2);
	const lightFill = color === ui.ready || color === ui.gold || color === ui.ink;
	const text = primary || lightFill ? ui.bg : ui.ink;
	return (
		<Pressable
			onPress={onPress}
			onPressIn={onPressIn}
			onPressOut={onPressOut}
			disabled={disabled}
			style={({ pressed }) => [
				styles.button,
				small && styles.buttonSmall,
				{ backgroundColor: fill, borderColor: primary || color ? "transparent" : ui.line, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
				style,
			]}
		>
			<Text style={[styles.buttonText, small && { fontSize: 13 }, { color: text }]} numberOfLines={1}>
				{label}
			</Text>
		</Pressable>
	);
}

export function Panel({ children, border = ui.line, fill = ui.panel, style }: { children: ReactNode; border?: string; fill?: string; style?: StyleProp<ViewStyle> }) {
	return <View style={[styles.panel, { borderColor: border, backgroundColor: fill }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
	eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase" },
	button: {
		paddingVertical: 12,
		paddingHorizontal: 22,
		borderRadius: 0,
		borderWidth: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	buttonSmall: { paddingVertical: 8, paddingHorizontal: 14 },
	buttonText: { fontFamily: fonts.displaySemi, fontSize: 16, letterSpacing: 1 },
	panel: { borderWidth: 1, borderRadius: 0, padding: 12 },
	layer: { position: "absolute" },
});
