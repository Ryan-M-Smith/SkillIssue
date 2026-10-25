import { StyleSheet, Text, View } from "react-native";

import type { LobbyView } from "@/service/lobby-client";
import type { TeamStats } from "../../../../../packages/protocol/events";
import { Body, Eyebrow, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, teamColor, ui } from "./theme";

const rows: [keyof TeamStats, string, (v: number) => string][] = [
	["kills", "Kills", String],
	["deaths", "Deaths", String],
	["hits", "Hits", String],
	["headshots", "Headshots", String],
	["bestStreak", "Best streak", String],
	["distance", "Distance", (v) => `${v} m`],
	["jumps", "Jumps", String],
	["sprintTime", "Sprint", (v) => `${v} s`],
];

export function GameOver({
	view,
	waiting,
	onPlayAgain,
	onMenu,
}: {
	view: LobbyView;
	waiting: boolean;
	onPlayAgain: () => void;
	onMenu: () => void;
}) {
	const r = view.result;
	const mine = view.me?.teamId ?? 1;
	const winner = r?.winningTeam ?? null;
	const headline = winner === null ? "DRAW" : winner === mine ? "VICTORY" : "DEFEAT";
	const color = winner === null ? ui.ink : teamColor(winner);
	const scores = r?.scores ?? [0, 0];
	const blue = r?.stats.find((s) => s.teamId === 1);
	const red = r?.stats.find((s) => s.teamId === 2);
	return (
		<View style={styles.screen}>
			<SplitBackground split={winner === 1 ? 0.8 : winner === 2 ? 0.2 : 0.5} />
			<View style={styles.left}>
				<Eyebrow>Game over</Eyebrow>
				<Title size={52} color={color}>{headline}</Title>
				<View style={styles.score}>
					<Title size={34} color={ui.blue}>{scores[0]}</Title>
					<Title size={34} color={ui.muted}>—</Title>
					<Title size={34} color={ui.red}>{scores[1]}</Title>
				</View>
				<Body size={14} color={ui.muted}>{winner === null ? "Nobody blinked." : `Team ${winner === 1 ? "Blue" : "Red"} takes it.`}</Body>
				<View style={styles.buttons}>
					<SlantButton label={waiting ? "WAITING FOR HOST…" : "PLAY AGAIN"} primary disabled={waiting} onPress={onPlayAgain} />
					<SlantButton label="MAIN MENU" onPress={onMenu} />
				</View>
			</View>
			<View style={styles.table}>
				<View style={styles.tr}>
					<Text style={[styles.th, { color: ui.blue }]}>BLUE</Text>
					<Text style={[styles.label, { color: ui.muted }]}> </Text>
					<Text style={[styles.th, { color: ui.red }]}>RED</Text>
				</View>
				{blue && red ? (
					rows.map(([key, label, fmt]) => {
						const b = Number(blue[key]) || 0;
						const rd = Number(red[key]) || 0;
						return (
							<View key={key} style={styles.tr}>
								<Text style={[styles.td, b >= rd ? styles.lead : null]}>{fmt(b)}</Text>
								<Text style={styles.label}>{label}</Text>
								<Text style={[styles.td, rd >= b ? styles.lead : null]}>{fmt(rd)}</Text>
							</View>
						);
					})
				) : (
					<Body size={13} color={ui.muted}>Stats will show here after a match.</Body>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, flexDirection: "row", padding: 22, gap: 22 },
	left: { flex: 1, justifyContent: "center", gap: 6 },
	score: { flexDirection: "row", gap: 14, alignItems: "center" },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
	table: { flex: 1, justifyContent: "center", gap: 4, backgroundColor: "rgba(7, 10, 18, 0.75)", borderRadius: 10, borderWidth: 1.5, borderColor: ui.line, padding: 12 },
	tr: { flexDirection: "row", alignItems: "center" },
	th: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 16 },
	td: { flex: 1, textAlign: "center", fontFamily: fonts.displaySemi, fontSize: 18, color: ui.muted },
	lead: { color: ui.ink },
	label: { flex: 1.2, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 13, color: ui.muted },
});
