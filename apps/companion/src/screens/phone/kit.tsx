import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { fonts, ui } from "./theme";

/** Full-screen blue | red background with a slanted, glowing seam. */
export function SplitBackground({ split = 0.5 }: { split?: number }) {
	return (
		<View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
			<View style={[StyleSheet.absoluteFill, { backgroundColor: ui.bg }]} />
			<View style={[styles.half, { left: 0, right: `${(1 - split) * 100}%`, backgroundColor: "rgba(59, 140, 255, 0.10)" }]} />
			<View style={[styles.half, { left: `${split * 100}%`, right: 0, backgroundColor: "rgba(255, 74, 74, 0.10)" }]} />
			<View style={[styles.seam, { left: `${split * 100}%` }]}>
				<View style={[styles.glow, { width: 28, backgroundColor: "rgba(59, 140, 255, 0.10)", left: -28 }]} />
				<View style={[styles.glow, { width: 28, backgroundColor: "rgba(255, 74, 74, 0.10)", left: 2 }]} />
				<View style={[styles.glow, { width: 2, backgroundColor: "rgba(255, 255, 255, 0.85)", left: 0 }]} />
			</View>
		</View>
	);
}

export function Title({ children, size = 34, color = ui.ink, style }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
	return <Text style={[{ fontFamily: fonts.display, fontSize: size, color, letterSpacing: 0.5 }, style]}>{children}</Text>;
}

export function Eyebrow({ children, color = ui.muted }: { children: ReactNode; color?: string }) {
	return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

export function Body({ children, color = ui.ink, size = 15, style }: { children: ReactNode; color?: string; size?: number; style?: StyleProp<TextStyle> }) {
	return <Text style={[{ fontFamily: fonts.body, fontSize: size, color, lineHeight: size * 1.3 }, style]}>{children}</Text>;
}

/** The game's slanted button. `primary` = white slab. `color` = team-colored fill. */
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
	textColor,
	icon,
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
	textColor?: string;
	/** Drawn left of the label (e.g. a sign-in provider's mark). */
	icon?: ReactNode;
}) {
	const fill = color ?? (primary ? ui.ink : ui.panel2);
	const text = textColor ?? (primary ? ui.bg : ui.ink);
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
			<View style={styles.buttonRow}>
				{icon}
				<Text style={[styles.buttonText, small && { fontSize: 13 }, { color: text, transform: [{ skewX: "12deg" }] }]} numberOfLines={1}>
					{label}
				</Text>
			</View>
		</Pressable>
	);
}

export function Panel({ children, border = ui.line, fill = ui.panel, style }: { children: ReactNode; border?: string; fill?: string; style?: StyleProp<ViewStyle> }) {
	return <View style={[styles.panel, { borderColor: border, backgroundColor: fill }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
	half: { position: "absolute", top: 0, bottom: 0 },
	seam: { position: "absolute", top: "-20%", bottom: "-20%", width: 0, transform: [{ rotate: "14deg" }] },
	glow: { position: "absolute", top: 0, bottom: 0 },
	eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase" },
	button: {
		paddingVertical: 12,
		paddingHorizontal: 22,
		borderRadius: 4,
		borderWidth: 1.5,
		alignItems: "center",
		justifyContent: "center",
		transform: [{ skewX: "-12deg" }],
	},
	buttonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	buttonSmall: { paddingVertical: 8, paddingHorizontal: 14 },
	buttonText: { fontFamily: fonts.displaySemi, fontSize: 16, letterSpacing: 0.6 },
	panel: { borderWidth: 1.5, borderRadius: 8, padding: 12 },
});
