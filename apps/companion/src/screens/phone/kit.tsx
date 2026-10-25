import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { fonts, ui } from "./theme";

export { SplitBackground } from "./split-background";

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
	const text = primary ? ui.bg : ui.ink;
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
			<Text style={[styles.buttonText, small && { fontSize: 13 }, { color: text, transform: [{ skewX: "12deg" }] }]} numberOfLines={1}>
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
		borderRadius: 4,
		borderWidth: 1.5,
		alignItems: "center",
		justifyContent: "center",
		transform: [{ skewX: "-12deg" }],
	},
	buttonSmall: { paddingVertical: 8, paddingHorizontal: 14 },
	buttonText: { fontFamily: fonts.displaySemi, fontSize: 16, letterSpacing: 0.6 },
	panel: { borderWidth: 1.5, borderRadius: 8, padding: 12 },
});
