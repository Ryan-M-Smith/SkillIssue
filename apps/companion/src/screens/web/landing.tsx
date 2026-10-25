import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useAccount } from "@/lib/account/account";
import { apiGet, type MyStats, type Summary } from "@/lib/account/api";
import { Body, Eyebrow, SlantButton, Title } from "@/screens/phone/kit";
import { fonts, ui } from "@/screens/phone/theme";

import { Leaderboard } from "./leaderboard";
import { Avatar, DailyBars, MatchCard, ProviderButtons, ProviderMark, Section, StatTile } from "./parts";

const repoUrl = "https://github.com/Ryan-M-Smith/SkillIssue";

/**
 * The website: an intro to the game for demos, the live leaderboard, and (signed in)
 * your own stats. Data comes from the SkillIssue API (apps/api) on Tiger Data;
 * sign-in is Auth0 with Google or GitHub.
 */
export default function Landing() {
	const account = useAccount();
	const { width } = useWindowDimensions();
	const wide = width >= 900;
	const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
	const anchors = useRef<Record<string, number>>({});
	const [summary, setSummary] = useState<Summary | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = () => apiGet<Summary>(account.apiUrl, "/api/summary").then((s) => !cancelled && setSummary(s), () => {});
		void load();
		const timer = setInterval(load, 15_000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [account.apiUrl]);

	const go = (id: string) => scroll.current?.scrollTo({ y: Math.max(0, (anchors.current[id] ?? 0) - 70), animated: true });
	const mark = (id: string, y: number) => (anchors.current[id] = y);

	return (
		<View style={styles.page}>
			<Nav wide={wide} onGo={go} />
			<ScrollView ref={scroll} contentContainerStyle={{ paddingTop: 64 }}>
				<Hero wide={wide} summary={summary} onGo={go} />
				<Section id="how" eyebrow="How it plays" title="Two phones. One body." onLayoutY={mark}
					intro="SkillIssue is a 2 v 2 on one big screen. Each team is a single character, and it takes two people to drive it: one phone moves, the other aims and shoots. Hold them sideways like a controller and start talking.">
					<View style={[styles.steps, !wide && { flexDirection: "column" }]}>
						<Step n="1" title="Host on the big screen" text="Open the game and press Create a Lobby. It shows a 6-character join code." />
						<Step n="2" title="Join with your phone" text="Open the SkillIssue app, enter the code, pick Blue or Red and Movement or Aim, then Ready." />
						<Step n="3" title="Move and shoot as one" text="First team to 10 kills wins, or whoever leads when the 5-minute clock runs out." />
					</View>
					<View style={[styles.roles, !wide && { flexDirection: "column" }]}>
						<Role color={ui.blue} title="MOVEMENT PHONE" rows={[
							["Tilt the top away / toward you", "Walk forward / back"],
							["Tip an end down", "Strafe"],
							["Flick forward", "Crouch"],
							["Flick back", "Jump"],
							["Twist like a wheel", "Sprint"],
						]} />
						<Role color={ui.red} title="AIM PHONE" rows={[
							["Turn the phone", "Look around"],
							["Jab forward or hold FIRE", "Shoot"],
							["SCOPE", "Zoom in (sniper)"],
							["Weapon buttons", "Pistol, shotgun, sniper"],
						]} />
					</View>
				</Section>

				<Section id="leaderboard" eyebrow="Live" title="All-time leaderboard" onLayoutY={mark}
					intro="Every signed-in player's career, updated as matches finish. Matches are stored in Tiger Data (TimescaleDB): a hypertable of every player's line in every match, rolled up per day by a real-time continuous aggregate.">
					<Leaderboard apiUrl={account.apiUrl} me={account.profile?.sub ?? null} compact={!wide} />
					{!!summary?.recent.length && (
						<View style={{ marginTop: 28 }}>
							<Eyebrow>Latest matches</Eyebrow>
							<View style={styles.matches}>
								{summary.recent.slice(0, wide ? 4 : 2).map((m) => <MatchCard key={m.id} match={m} />)}
							</View>
						</View>
					)}
				</Section>

				<Section id="me" eyebrow="Your stats" title={account.profile ? `Welcome back, ${account.profile.name}` : "Sign in to see your stats"} onLayoutY={mark}>
					<MyStatsPanel wide={wide} />
				</Section>

				<Footer />
			</ScrollView>
		</View>
	);
}

function Nav({ wide, onGo }: { wide: boolean; onGo: (id: string) => void }) {
	const account = useAccount();
	return (
		<View style={styles.nav}>
			<Pressable onPress={() => onGo("top")} style={styles.brand}>
				<Title size={22} color={ui.blue}>SKILL</Title>
				<Title size={22} color={ui.red}>ISSUE</Title>
			</Pressable>
			{wide && (
				<View style={styles.links}>
					{[["how", "How it plays"], ["leaderboard", "Leaderboard"], ["me", "My stats"]].map(([id, label]) => (
						<Pressable key={id} onPress={() => onGo(id)}>
							<Text style={styles.link}>{label}</Text>
						</Pressable>
					))}
				</View>
			)}
			<View style={{ marginLeft: "auto" }}>
				{account.profile ? (
					<Pressable onPress={() => onGo("me")} style={styles.me}>
						<Avatar uri={account.profile.picture} name={account.profile.name} size={30} />
						<Text style={styles.link}>{account.profile.name}</Text>
					</Pressable>
				) : (
					<ProviderButtons compact onSignIn={(p) => account.signIn(p)} disabled={!account.config?.auth || account.busy} />
				)}
			</View>
		</View>
	);
}

function Hero({ wide, summary, onGo }: { wide: boolean; summary: Summary | null; onGo: (id: string) => void }) {
	return (
		<View style={[styles.hero, { minHeight: wide ? 640 : 560 }]}>
			<HeroBackground />
			<View style={[styles.heroInner, !wide && { paddingTop: 40 }]}>
				<Eyebrow>2 v 2 · two phones per team · one screen</Eyebrow>
				<View style={styles.wordmark}>
					<Title size={wide ? 132 : 72} color={ui.blue}>SKILL</Title>
					<Title size={wide ? 132 : 72} color={ui.red}>ISSUE</Title>
				</View>
				<Body size={wide ? 26 : 20} style={{ maxWidth: 640 }}>One of you moves. One of you shoots. Nobody has the full picture.</Body>
				<View style={styles.ctas}>
					<SlantButton label="SEE THE LEADERBOARD" primary onPress={() => onGo("leaderboard")} />
					<SlantButton label="HOW IT PLAYS" onPress={() => onGo("how")} />
				</View>
				<View style={styles.tiles}>
					<StatTile label="Matches played" value={summary?.matches ?? "—"} note={summary ? `${summary.matches_today} in the last 24 h` : undefined} />
					<StatTile label="Players signed up" value={summary?.players ?? "—"} />
					<StatTile label="Total kills" value={summary?.kills ?? "—"} />
				</View>
			</View>
		</View>
	);
}

/** Blue and red halves meeting at a glowing, slanted seam (the game's look). */
function HeroBackground() {
	return (
		<View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
			<View style={[StyleSheet.absoluteFill, { backgroundColor: ui.bg }]} />
			<View style={[styles.heroHalf, { left: "-20%", right: "38%", backgroundColor: "rgba(59, 140, 255, 0.13)" }]} />
			<View style={[styles.heroHalf, { left: "62%", right: "-20%", backgroundColor: "rgba(255, 74, 74, 0.13)" }]} />
			<View style={[styles.seam, { left: "62%" }]}>
				<View style={[styles.glow, { left: -60, width: 60, backgroundColor: "rgba(59, 140, 255, 0.16)" }]} />
				<View style={[styles.glow, { left: 3, width: 60, backgroundColor: "rgba(255, 74, 74, 0.16)" }]} />
				<View style={[styles.glow, { left: 0, width: 3, backgroundColor: "rgba(255,255,255,0.9)" }]} />
			</View>
			<View style={styles.heroFade} />
		</View>
	);
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
	return (
		<View style={styles.step}>
			<Title size={56} color="rgba(242,245,255,0.18)">{n}</Title>
			<Title size={24}>{title}</Title>
			<Body size={16} color={ui.muted}>{text}</Body>
		</View>
	);
}

function Role({ color, title, rows }: { color: string; title: string; rows: string[][] }) {
	return (
		<View style={[styles.role, { borderColor: color }]}>
			<Title size={26} color={color}>{title}</Title>
			{rows.map(([a, b]) => (
				<View key={a} style={styles.roleRow}>
					<Body size={16} style={{ flex: 1 }}>{a}</Body>
					<Body size={16} color={ui.muted}>{b}</Body>
				</View>
			))}
		</View>
	);
}

function MyStatsPanel({ wide }: { wide: boolean }) {
	const account = useAccount();
	const [stats, setStats] = useState<MyStats | null>(null);
	const [error, setError] = useState<string | null>(null);
	const sub = account.profile?.sub;

	useEffect(() => {
		setStats(null);
		setError(null);
		if (!sub) return;
		account.myStats().then(setStats, (e) => setError((e as Error).message));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sub]);

	if (!account.profile) {
		return (
			<View style={styles.signIn}>
				<Body size={18} style={{ maxWidth: 620 }}>
					Sign in with the same Google or GitHub account you use in the phone app. Your matches, wins, kills, accuracy and distance are saved to your account and ranked against everyone else.
				</Body>
				<ProviderButtons onSignIn={(p) => account.signIn(p)} disabled={!account.config?.auth || account.busy} />
				{!!account.error && <Body size={14} color={ui.gold}>{account.error}</Body>}
				{!account.config?.auth && (
					<Body size={14} color={ui.muted}>{account.configError ?? (account.config ? "Sign-in isn't set up on this server yet." : "Connecting…")}</Body>
				)}
			</View>
		);
	}

	const t = stats?.totals;
	return (
		<View style={{ gap: 24 }}>
			<View style={styles.profile}>
				<Avatar uri={account.profile.picture} name={account.profile.name} size={64} />
				<View style={{ flex: 1 }}>
					<Title size={30}>{account.profile.name}</Title>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<ProviderMark provider={account.profile.provider} size={16} />
						<Body size={14} color={ui.muted}>Signed in with {account.profile.provider.startsWith("github") ? "GitHub" : "Google"}</Body>
					</View>
				</View>
				<SlantButton label="SIGN OUT" small onPress={() => account.signOut()} />
			</View>
			{error && <Body color={ui.gold}>{error}</Body>}
			{!stats && !error && <Body color={ui.muted}>Loading your stats…</Body>}
			{stats && !t && <Body color={ui.muted}>No matches yet. Join a lobby from the phone app while signed in and your first match lands here.</Body>}
			{t && (
				<>
					<View style={styles.tiles}>
						<StatTile label="Rank" value={stats?.rank ? `#${stats.rank}` : "—"} note="all-time, by wins" />
						<StatTile label="Wins" value={t.wins} note={`of ${t.matches} matches`} />
						<StatTile label="Kills" value={t.kills} note={`K/D ${t.kd.toFixed(2)}`} />
						<StatTile label="Accuracy" value={t.shots ? `${Math.round(t.accuracy * 100)}%` : "—"} note={`${t.hits} hits · ${t.headshots} headshots`} />
						<StatTile label="Distance" value={`${t.distance_m.toLocaleString()} m`} note={`${t.jumps} jumps · ${t.sprint_s}s sprinting`} />
					</View>
					<View style={[styles.mineRow, !wide && { flexDirection: "column" }]}>
						<View style={[styles.panel, { flex: 1.2 }]}>
							<DailyBars days={stats!.daily} />
						</View>
						<View style={{ flex: 1, gap: 12 }}>
							<Eyebrow>Your recent matches</Eyebrow>
							{stats!.recent.slice(0, 3).map((m) => <MatchCard key={m.id} match={m} />)}
						</View>
					</View>
				</>
			)}
		</View>
	);
}

function Footer() {
	return (
		<View style={styles.footer}>
			<View style={styles.brand}>
				<Title size={18} color={ui.blue}>SKILL</Title>
				<Title size={18} color={ui.red}>ISSUE</Title>
			</View>
			<Body size={14} color={ui.muted}>Sign-in by Auth0 · stats on Tiger Data · domain from GoDaddy Registry</Body>
			<View style={{ flexDirection: "row", gap: 18, marginLeft: "auto" }}>
				<Pressable onPress={() => Linking.openURL("/debug")}><Text style={styles.link}>Motion debugger</Text></Pressable>
				<Pressable onPress={() => Linking.openURL(repoUrl)}><Text style={styles.link}>GitHub</Text></Pressable>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, backgroundColor: ui.bg },
	nav: {
		position: "absolute", top: 0, left: 0, right: 0, height: 64, zIndex: 10,
		flexDirection: "row", alignItems: "center", gap: 28, paddingHorizontal: 24,
		backgroundColor: "rgba(7, 10, 18, 0.86)", borderBottomWidth: 1, borderBottomColor: ui.line,
	},
	brand: { flexDirection: "row", gap: 8 },
	links: { flexDirection: "row", gap: 22 },
	link: { fontFamily: fonts.bodySemi, fontSize: 16, color: ui.ink },
	me: { flexDirection: "row", alignItems: "center", gap: 10 },
	hero: { justifyContent: "center" },
	heroHalf: { position: "absolute", top: 0, bottom: 0 },
	seam: { position: "absolute", top: "-30%", bottom: "-30%", width: 0, transform: [{ rotate: "14deg" }] },
	glow: { position: "absolute", top: 0, bottom: 0 },
	heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 120, backgroundColor: "rgba(7,10,18,0.55)" },
	heroInner: { width: "100%", maxWidth: 1180, alignSelf: "center", paddingHorizontal: 24, gap: 14 },
	wordmark: { flexDirection: "row", flexWrap: "wrap", columnGap: 24 },
	ctas: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 12 },
	tiles: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 20 },
	steps: { flexDirection: "row", gap: 18 },
	step: { flex: 1, gap: 6, padding: 20, borderRadius: 8, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.panel },
	roles: { flexDirection: "row", gap: 18, marginTop: 18 },
	role: { flex: 1, gap: 10, padding: 20, borderRadius: 8, borderWidth: 1.5, backgroundColor: ui.panel },
	roleRow: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)", paddingTop: 8 },
	matches: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 12 },
	signIn: { gap: 18, padding: 24, borderRadius: 10, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.panel },
	profile: { flexDirection: "row", alignItems: "center", gap: 16 },
	mineRow: { flexDirection: "row", gap: 18 },
	panel: { padding: 18, borderRadius: 8, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.panel },
	footer: {
		flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 18, paddingVertical: 28, paddingHorizontal: 24,
		borderTopWidth: 1, borderTopColor: ui.line, marginTop: 40,
	},
});
