import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

import type { Cue } from "./haptic-cues";

export type { Cue } from "./haptic-cues";
export { gestureCue, lobbyCues } from "./haptic-cues";

const { ImpactFeedbackStyle: Impact, NotificationFeedbackType: Notify } = Haptics;

/** How each cue feels: short taps for controls, notifications for big moments. */
const play: Record<Cue, () => Promise<void>> = {
	tap: () => Haptics.impactAsync(Impact.Light),
	select: () => Haptics.selectionAsync(),
	fire: () => Haptics.impactAsync(Impact.Heavy),
	jump: () => Haptics.impactAsync(Impact.Medium),
	crouch: () => Haptics.impactAsync(Impact.Soft),
	sprint: () => Haptics.impactAsync(Impact.Rigid),
	calibrated: () => Haptics.impactAsync(Impact.Light),
	hit: () => Haptics.impactAsync(Impact.Heavy),
	down: () => Haptics.notificationAsync(Notify.Error),
	respawn: () => Haptics.notificationAsync(Notify.Success),
	empty: () => Haptics.notificationAsync(Notify.Warning),
	reloaded: () => Haptics.impactAsync(Impact.Soft),
	ready: () => Haptics.notificationAsync(Notify.Success),
	joined: () => Haptics.notificationAsync(Notify.Success),
	failed: () => Haptics.notificationAsync(Notify.Error),
	kickoff: () => Haptics.notificationAsync(Notify.Warning),
	victory: () => Haptics.notificationAsync(Notify.Success),
	defeat: () => Haptics.notificationAsync(Notify.Error),
	draw: () => Haptics.notificationAsync(Notify.Warning),
};

/** Minimum gap per cue, so bursts (rapid hits, a held twist) don't turn into a constant buzz. */
const gapMs: Partial<Record<Cue, number>> = { hit: 140, select: 60 };
const lastAt: Partial<Record<Cue, number>> = {};

/** Play a haptic cue. Silently does nothing on web or devices without a haptic engine. */
export function haptic(cue: Cue) {
	if (Platform.OS === "web") return;
	const now = Date.now();
	if (now - (lastAt[cue] ?? 0) < (gapMs[cue] ?? 40)) return;
	lastAt[cue] = now;
	play[cue]().catch(() => {});
}
