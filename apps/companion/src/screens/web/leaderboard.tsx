import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { apiGet, type LeaderboardSort, type PlayerTotals } from "@/lib/account/api";
import { Body, Eyebrow } from "@/screens/phone/kit";
import { fonts, ui } from "@/screens/phone/theme";

import { Avatar, ProviderMark } from "./parts";

const refreshMs = 10_000;

const sorts: { key: LeaderboardSort; label: string }[] = [
	{ key: "wins", label: "Wins" },
	{ key: "kills", label: "Kills" },
	{ key: "accuracy", label: "Accuracy" },
	{ key: "kd", label: "K/D" },
	{ key: "distance", label: "Distance" },
];

type Column = { key: string; label: string; sort?: LeaderboardSort; value: (p: PlayerTotals) => string; wide?: boolean };

const columns: Column[] = [
	{ key: "matches", label: "Matches", value: (p) => String(p.matches) },
	{ key: "wins", label: "Wins", sort: "wins", value: (p) => String(p.wins) },
	{ key: "kills", label: "Kills", sort: "kills", value: (p) => String(p.kills) },
	{ key: "kd", label: "K/D", sort: "kd", value: (p) => p.kd.toFixed(2), wide: true },
	{ key: "accuracy", label: "Accuracy", sort: "accuracy", value: (p) => (p.shots ? `${Math.round(p.accuracy * 100)}%` : "—") },
	{ key: "distance", label: "Distance", sort: "distance", value: (p) => `${p.distance_m.toLocaleString()} m`, wide: true },
];

/** The live all-time (or this week's) leaderboard. Refreshes every 10 s. */
export function Leaderboard({ apiUrl, me, compact }: { apiUrl: string; me: string | null; compact: boolean }) {
	const [period, setPeriod] = useState<"all" | "week">("all");
	const [sort, setSort] = useState<LeaderboardSort>("wins");
	const [rows, setRows] = useState<PlayerTotals[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [updated, setUpdated] = useState<number | null>(null);
	const [, tick] = useState(0);

	const load = useCallback(async () => {
		try {
			const r = await apiGet<{ players: PlayerTotals[] }>(apiUrl, `/api/leaderboard?period=${period}&sort=${sort}&limit=25`);
			setRows(r.players);
			setError(null);
			setUpdated(Date.now());
		} catch (e) {
			setError((e as Error).message);
		}
	}, [apiUrl, period, sort]);

	useEffect(() => {
		void load();
		const timer = setInterval(load, refreshMs);
		const clock = setInterval(() => tick((n) => n + 1), 1000);
		return () => {
			clearInterval(timer);
			clearInterval(clock);
		};
	}, [load]);

	const shown = compact ? columns.filter((c) => !c.wide) : columns;
	const ago = updated ? Math.round((Date.now() - updated) / 1000) : null;

	return (
		<View style={styles.card}>
			<View style={styles.controls}>
				<View style={styles.group}>
					<Chip label="All-time" on={period === "all"} onPress={() => setPeriod("all")} />
					<Chip label="This week" on={period === "week"} onPress={() => setPeriod("week")} />
				</View>
				<View style={styles.group}>
					<Eyebrow>Rank by</Eyebrow>
					{sorts.map((s) => (
						<Chip key={s.key} label={s.label} on={sort === s.key} onPress={() => setSort(s.key)} />
					))}
				</View>
				<View style={[styles.group, { marginLeft: "auto" }]}>
					<View style={[styles.liveDot, { backgroundColor: error ? ui.gold : ui.ready }]} />
					<Eyebrow color={error ? ui.gold : ui.muted}>{error ? "Offline" : ago === null ? "Loading" : `Live · ${ago}s ago`}</Eyebrow>
				</View>
			</View>

			<View style={[styles.row, styles.head]}>
				<Text style={[styles.headText, styles.rank]}>#</Text>
				<Text style={[styles.headText, { flex: 1 }]}>Player</Text>
				{shown.map((c) => (
					<Pressable key={c.key} disabled={!c.sort} onPress={() => c.sort && setSort(c.sort)} style={styles.num}>
						<Text style={[styles.headText, { textAlign: "right", color: c.sort === sort ? ui.ink : ui.muted }]}>
							{c.label}{c.sort === sort ? " ▾" : ""}
						</Text>
					</Pressable>
				))}
			</View>

			{rows === null && !error && <Body color={ui.muted} style={styles.empty}>Loading the leaderboard…</Body>}
			{error && rows === null && <Body color={ui.gold} style={styles.empty}>{error}</Body>}
			{rows?.length === 0 && (
				<Body color={ui.muted} style={styles.empty}>
					{period === "week" ? "No signed-in matches this week yet." : "No matches yet. Host one from the game and sign in on your phone to get on the board."}
				</Body>
			)}
			{rows?.map((p) => {
				const mine = p.player_id === me;
				return (
					<View key={p.player_id} style={[styles.row, mine && styles.mine]}>
						<Text style={[styles.cell, styles.rank, p.rank === 1 && { color: ui.gold }]}>{p.rank}</Text>
						<View style={styles.player}>
							<Avatar uri={p.avatar_url} name={p.display_name} size={30} />
							<Text numberOfLines={1} style={[styles.cell, { flexShrink: 1 }]}>{p.display_name}</Text>
							<ProviderMark provider={p.provider} size={16} />
							{mine && <Eyebrow color={ui.ready}>You</Eyebrow>}
						</View>
						{shown.map((c) => (
							<Text key={c.key} style={[styles.cell, styles.num, { textAlign: "right", color: c.sort === sort ? ui.ink : "rgba(242,245,255,0.78)" }]}>
								{c.value(p)}
							</Text>
						))}
					</View>
				);
			})}
		</View>
	);
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
	return (
		<Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
			<Text style={[styles.chipText, { color: on ? ui.bg : ui.ink }]}>{label}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	card: { borderRadius: 10, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.panel, overflow: "hidden" },
	controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: ui.line },
	group: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
	chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: ui.line },
	chipOn: { backgroundColor: ui.ink, borderColor: ui.ink },
	chipText: { fontFamily: fonts.bodySemi, fontSize: 14 },
	liveDot: { width: 8, height: 8, borderRadius: 4 },
	row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
	head: { paddingVertical: 8 },
	headText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: ui.muted },
	mine: { backgroundColor: "rgba(84, 237, 166, 0.08)" },
	rank: { width: 28, fontFamily: fonts.display },
	player: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
	cell: { fontFamily: fonts.bodySemi, fontSize: 16, color: ui.ink },
	num: { width: 84 },
	empty: { padding: 24 },
});
