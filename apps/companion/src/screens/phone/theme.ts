import type { TeamId } from "@/service/lobby-client";

/** Same palette as the game's menus (apps/game/ui/ui_kit.gd). */
export const ui = {
	bg: "#070A12",
	panel: "rgba(15, 20, 36, 0.92)",
	panel2: "#161D33",
	line: "rgba(255, 255, 255, 0.14)",
	ink: "#F2F5FF",
	muted: "#8E97B2",
	blue: "#3B8CFF",
	red: "#FF4A4A",
	gold: "#FFCB52",
	ready: "#54EDA6",
};

export const fonts = {
	display: "ChakraPetch-Bold",
	displaySemi: "ChakraPetch-SemiBold",
	body: "BarlowSemiCondensed-Medium",
	bodySemi: "BarlowSemiCondensed-SemiBold",
	bodyBold: "BarlowSemiCondensed-Bold",
};

/** For expo-font's useFonts (see app/_layout.tsx). */
export const fontAssets = {
	[fonts.display]: require("../../../assets/fonts/ChakraPetch-Bold.ttf"),
	[fonts.displaySemi]: require("../../../assets/fonts/ChakraPetch-SemiBold.ttf"),
	[fonts.body]: require("../../../assets/fonts/BarlowSemiCondensed-Medium.ttf"),
	[fonts.bodySemi]: require("../../../assets/fonts/BarlowSemiCondensed-SemiBold.ttf"),
	[fonts.bodyBold]: require("../../../assets/fonts/BarlowSemiCondensed-Bold.ttf"),
};

export const teamColor = (team: TeamId | null | undefined) => (team === 2 ? ui.red : ui.blue);
export const teamName = (team: TeamId | null | undefined) => (team === 2 ? "RED" : "BLUE");

/** A team color at low strength, for panel fills. */
export const teamTint = (team: TeamId | null | undefined, alpha = 0.16) =>
	team === 2 ? `rgba(255, 74, 74, ${alpha})` : `rgba(59, 140, 255, ${alpha})`;
