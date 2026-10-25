import { useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { Provider } from "@/lib/account/account";
import type { MatchSummary } from "@/lib/account/api";
import { Body, Eyebrow, SlantButton, Title } from "@/screens/phone/kit";
import { fonts, ui } from "@/screens/phone/theme";

/** A page section with an eyebrow, a big heading and a short intro. */
export function Section({ id, eyebrow, title, intro, children, onLayoutY }: {
	id: string;
	eyebrow: string;
	title: ReactNode;
	intro?: string;
	children: ReactNode;
	onLayoutY?: (id: string, y: number) => void;
}) {
	return (
		<View style={styles.section} onLayout={(e) => onLayoutY?.(id, e.nativeEvent.layout.y)} nativeID={id}>
			<Eyebrow>{eyebrow}</Eyebrow>
			<Title size={44} style={{ marginTop: 6 }}>{title}</Title>
			{intro ? <Body size={18} color={ui.muted} style={{ maxWidth: 720, marginTop: 8 }}>{intro}</Body> : null}
			<View style={{ marginTop: 28 }}>{children}</View>
		</View>
	);
}

/** One headline number. */
export function StatTile({ label, value, note, style }: { label: string; value: string | number; note?: string; style?: StyleProp<ViewStyle> }) {
	return (
		<View style={[styles.tile, style]}>
			<Eyebrow>{label}</Eyebrow>
			<Title size={40} style={{ marginTop: 4 }}>{typeof value === "number" ? value.toLocaleString() : value}</Title>
			{note ? <Body size={13} color={ui.muted}>{note}</Body> : null}
		</View>
	);
}

export function Avatar({ uri, name, size = 36 }: { uri: string | null | undefined; name: string; size?: number }) {
	const round = { width: size, height: size, borderRadius: size / 2 };
	return uri ? (
		<Image source={{ uri }} style={[round, styles.avatarRing]} />
	) : (
		<View style={[round, styles.avatarRing, { backgroundColor: ui.panel2, alignItems: "center", justifyContent: "center" }]}>
			<Title size={size * 0.45} color={ui.muted}>{(name[0] ?? "?").toUpperCase()}</Title>
		</View>
	);
}

/** "Sign in with Google" / "Sign in with GitHub". */
export function ProviderButtons({ onSignIn, disabled, compact = false }: { onSignIn: (p: Provider) => void; disabled?: boolean; compact?: boolean }) {
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
			{(["google", "github"] as const).map((p) => {
				const google = p === "google";
				return (
					<SlantButton
						key={p}
						label={compact ? (google ? "GOOGLE" : "GITHUB") : google ? "SIGN IN WITH GOOGLE" : "SIGN IN WITH GITHUB"}
						onPress={() => onSignIn(p)}
						disabled={disabled}
						small={compact}
						color={google ? "#FFFFFF" : "#0D1117"}
						textColor={google ? "#1F2433" : ui.ink}
						style={!google && { borderColor: "rgba(255,255,255,0.35)" }}
						icon={<ProviderMark provider={p} size={compact ? 18 : 22} />}
					/>
				);
			})}
		</View>
	);
}

export function ProviderMark({ provider, size = 22 }: { provider: string | null | undefined; size?: number }) {
	const github = provider?.startsWith("github");
	return (
		<View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: github ? ui.ink : "#4285F4", alignItems: "center", justifyContent: "center", transform: [{ skewX: "12deg" }] }}>
			<Text style={{ fontFamily: fonts.display, fontSize: size * (github ? 0.42 : 0.6), color: github ? "#0D1117" : "#FFFFFF" }}>{github ? "GH" : "G"}</Text>
		</View>
	);
}

/** Blue score vs red score, and who played. */
export function MatchCard({ match }: { match: MatchSummary }) {
	const blue = match.players.filter((p) => p.teamId === 1);
	const red = match.players.filter((p) => p.teamId === 2);
	const winner = match.winning_team;
	return (
		<View style={styles.match}>
			<View style={styles.matchHead}>
				<Eyebrow>{timeAgo(match.ended_at)} · {match.reason === "kills" ? "first to 10" : "time's up"}</Eyebrow>
				<Eyebrow color={winner === 1 ? ui.blue : winner === 2 ? ui.red : ui.muted}>{winner === 1 ? "BLUE WINS" : winner === 2 ? "RED WINS" : "DRAW"}</Eyebrow>
			</View>
			<View style={styles.matchRow}>
				<Roster players={blue} color={ui.blue} />
				<View style={styles.score}>
					<Title size={30}>{match.blue_score}</Title>
					<Title size={20} color={ui.muted}>–</Title>
					<Title size={30}>{match.red_score}</Title>
				</View>
				<Roster players={red} color={ui.red} right />
			</View>
		</View>
	);
}

function Roster({ players, color, right = false }: { players: MatchSummary["players"]; color: string; right?: boolean }) {
	return (
		<View style={{ flex: 1, gap: 4, alignItems: right ? "flex-end" : "flex-start" }}>
			<View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: color }} />
			{players.map((p, i) => (
				<Text key={i} numberOfLines={1} style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: p.signedIn ? ui.ink : ui.muted }}>
					{p.name}
					<Text style={{ color: ui.muted, fontFamily: fonts.body }}>{p.role === "aim" ? " · aim" : " · move"}</Text>
				</Text>
			))}
		</View>
	);
}

/**
 * Matches per day for the last 30 days: one series, one neutral hue, bars anchored
 * to the baseline with rounded tops, a tooltip on hover/tap. Days with no match
 * keep their slot so gaps read as gaps.
 */
export function DailyBars({ days }: { days: { day: string; matches: number; wins: number; kills: number }[] }) {
	const [hover, setHover] = useState<number | null>(null);
	const byDay = new Map(days.map((d) => [d.day.slice(0, 10), d]));
	const slots = Array.from({ length: 30 }, (_, i) => {
		const date = new Date(Date.now() - (29 - i) * 86_400_000);
		const key = date.toISOString().slice(0, 10);
		return { key, date, row: byDay.get(key) };
	});
	const max = Math.max(1, ...slots.map((s) => s.row?.matches ?? 0));
	const h = 120;
	const active = hover !== null ? slots[hover] : null;
	return (
		<View>
			<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
				<Body size={15} color={ui.ink}>Matches per day, last 30 days</Body>
				<Body size={13} color={ui.muted}>
					{active
						? `${active.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${active.row?.matches ?? 0} matches, ${active.row?.wins ?? 0} wins, ${active.row?.kills ?? 0} kills`
						: "Hover a day"}
				</Body>
			</View>
			<View style={[styles.bars, { height: h }]}>
				{[0.5, 1].map((f) => (
					<View key={f} style={[styles.grid, { bottom: h * f }]} />
				))}
				{slots.map((s, i) => {
					const v = s.row?.matches ?? 0;
					return (
						<Pressable key={s.key} onHoverIn={() => setHover(i)} onHoverOut={() => setHover(null)} onPress={() => setHover(i)} style={styles.barSlot}>
							<View
								style={{
									height: v ? Math.max(4, (v / max) * (h - 8)) : 0,
									backgroundColor: hover === i ? ui.ink : "rgba(242, 245, 255, 0.55)",
									borderTopLeftRadius: 4,
									borderTopRightRadius: 4,
								}}
							/>
						</Pressable>
					);
				})}
			</View>
			<View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
				<Body size={12} color={ui.muted}>{slots[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Body>
				<Body size={12} color={ui.muted}>max {max} / day</Body>
				<Body size={12} color={ui.muted}>Today</Body>
			</View>
		</View>
	);
}

export function timeAgo(iso: string): string {
	const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86_400)} d ago`;
}

const styles = StyleSheet.create({
	section: { paddingVertical: 72, width: "100%", maxWidth: 1180, alignSelf: "center", paddingHorizontal: 24 },
	tile: { flexGrow: 1, flexBasis: 180, padding: 18, borderRadius: 8, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.panel },
	avatarRing: { borderWidth: 1.5, borderColor: ui.line },
	match: { flexGrow: 1, flexBasis: 320, padding: 16, borderRadius: 8, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.panel, gap: 10 },
	matchHead: { flexDirection: "row", justifyContent: "space-between" },
	matchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
	score: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 },
	bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, marginTop: 12, borderBottomWidth: 1, borderBottomColor: ui.line },
	barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
	grid: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.06)" },
});
