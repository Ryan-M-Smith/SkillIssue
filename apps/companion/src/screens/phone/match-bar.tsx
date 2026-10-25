import { StyleSheet, Text, View } from "react-native";

import type { LobbyView, TeamId } from "@/service/lobby-client";
import { fonts, teamColor, teamName, teamTint, ui } from "./theme";

/** Team tag, live score and clock across the top of the in-match screens. */
export function MatchBar({ view, role, calibrated }: { view: LobbyView; role: string; calibrated: boolean }) {
	const team = view.me?.teamId ?? 1;
	const scores = view.status?.scores ?? [0, 0];
	const t = Math.ceil(view.status?.timeLeft ?? 0);
	const clock = view.status ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` : "—:—";
	return (
		<View style={[styles.bar, { borderColor: teamColor(team), backgroundColor: teamTint(team, 0.18) }]}>
			<View style={{ flex: 1 }}>
				<Text style={[styles.team, { color: teamColor(team) }]}>TEAM {teamName(team)}</Text>
				<Text style={styles.role}>{role} · {calibrated ? "calibrated" : "hold still to calibrate"}</Text>
			</View>
			<Score team={1} value={scores[0]} />
			<View style={styles.clock}>
				<Text style={[styles.clockText, t <= 30 && view.status ? { color: ui.gold } : null]}>{clock}</Text>
				<Text style={styles.target}>FIRST TO {view.status?.killTarget || 10}</Text>
			</View>
			<Score team={2} value={scores[1]} />
		</View>
	);
}

function Score({ team, value }: { team: TeamId; value: number }) {
	return (
		<View style={[styles.score, { backgroundColor: teamTint(team, 0.55), borderColor: teamColor(team) }]}>
			<Text style={styles.scoreText}>{value}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	bar: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
	team: { fontFamily: fonts.display, fontSize: 18 },
	role: { fontFamily: fonts.body, fontSize: 12, color: ui.muted },
	score: { minWidth: 48, alignItems: "center", borderWidth: 1.5, borderRadius: 6, paddingVertical: 2, transform: [{ skewX: "-12deg" }] },
	scoreText: { fontFamily: fonts.display, fontSize: 24, color: ui.ink, transform: [{ skewX: "12deg" }] },
	clock: { alignItems: "center", minWidth: 70 },
	clockText: { fontFamily: fonts.display, fontSize: 22, color: ui.ink },
	target: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 1, color: ui.muted },
});
