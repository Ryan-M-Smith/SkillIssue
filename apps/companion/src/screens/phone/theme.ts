import type { TeamId } from "@/service/lobby-client";

/**
 * Same palette as the game's menus (apps/game/ui/ui_kit.gd): film noir. Black, grays and
 * off-white like an old movie title card; red and blue only as small team marks.
 */
export const ui = {
	bg: "#080808",
	panel: "rgba(12, 12, 12, 0.92)",
	panel2: "#1A1A1A",
	line: "rgba(255, 255, 255, 0.16)",
	ink: "#E6E3DB",
	muted: "#8C8B88",
	soft: "#B5B3AE",  // secondary text on dark panels (easier to read than muted)
	blue: "#3B8CFF",
	red: "#FF4A4A",
	gold: "#FFF8E6",   // highlight: a hot white
	ready: "#EBEBE6",
};

export const fonts = {
	display: "BarlowSemiCondensed-Bold",
	displaySemi: "BarlowSemiCondensed-SemiBold",
	body: "BarlowSemiCondensed-Medium",
	bodySemi: "BarlowSemiCondensed-SemiBold",
	bodyBold: "BarlowSemiCondensed-Bold",
	script: "TeXGyreChorus-MediumItalic",   // title-card script ("presents", "vs.")
};

/** For expo-font's useFonts (see app/_layout.tsx). */
export const fontAssets = {
	[fonts.body]: require("../../../assets/fonts/BarlowSemiCondensed-Medium.ttf"),
	[fonts.bodySemi]: require("../../../assets/fonts/BarlowSemiCondensed-SemiBold.ttf"),
	[fonts.bodyBold]: require("../../../assets/fonts/BarlowSemiCondensed-Bold.ttf"),
	[fonts.script]: require("../../../assets/fonts/TeXGyreChorus-MediumItalic.otf"),
};

export const teamColor = (team: TeamId | null | undefined) => (team === 2 ? ui.red : ui.blue);
export const teamName = (team: TeamId | null | undefined) => (team === 2 ? "RED" : "BLUE");

/** A team color at low strength, for panel fills. */
export const teamTint = (team: TeamId | null | undefined, alpha = 0.16) =>
	team === 2 ? `rgba(255, 74, 74, ${alpha})` : `rgba(59, 140, 255, ${alpha})`;

/**
 * A team color blended into the background, fully opaque: for panels that sit on the
 * split backdrop, so its seam and stripes never show through text.
 */
export const teamSolid = (team: TeamId | null | undefined, strength = 0.16) => {
	const color = team === 2 ? [255, 74, 74] : [59, 140, 255];
	const base = [8, 8, 8]; // ui.bg
	const mix = color.map((c, i) => Math.round(base[i] + (c - base[i]) * strength));
	return `rgb(${mix.join(", ")})`;
};
