import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { redirectUri, useAccount, type Provider } from "@/lib/account/account";
import type { MyStats } from "@/lib/account/api";

import { Body, Eyebrow, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, ui } from "./theme";

/**
 * Sign in with Google or GitHub (Auth0), or play as a guest. Signed in, a phone's
 * matches count toward its owner's stats and the leaderboard. Also the account
 * screen: who you are, your career numbers, sign out.
 */
export function SignIn({ onDone, first = false }: { onDone: () => void; first?: boolean }) {
	const account = useAccount();
	const { profile, busy, error, config, configError } = account;
	const [stats, setStats] = useState<MyStats | null>(null);
	const [statsError, setStatsError] = useState<string | null>(null);
	const [settings, setSettings] = useState(false);

	useEffect(() => {
		if (!profile) {
			setStats(null);
			return;
		}
		account.myStats().then(setStats, (e) => setStatsError((e as Error).message));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profile?.sub]);

	async function go(provider: Provider) {
		if (await account.signIn(provider)) onDone();
	}

	const authReady = !!config?.auth;
	const t = stats?.totals;

	return (
		<View style={styles.screen}>
			<SplitBackground split={0.58} />
			<View style={styles.left}>
				<Eyebrow>{profile ? "Your account" : "Sign in"}</Eyebrow>
				<View style={styles.wordmark}>
					<Title size={44} color={ui.blue}>SKILL</Title>
					<Title size={44} color={ui.red}>ISSUE</Title>
				</View>
				{profile ? (
					<View style={styles.me}>
						{profile.picture ? <Image source={{ uri: profile.picture }} style={styles.avatar} /> : <View style={[styles.avatar, { backgroundColor: ui.panel2 }]} />}
						<View>
							<Title size={26}>{profile.name}</Title>
							<Body size={13} color={ui.muted}>Signed in with {profile.provider.startsWith("github") ? "GitHub" : "Google"}</Body>
						</View>
					</View>
				) : (
					<Body size={16}>Sign in so your wins, kills and accuracy follow you to the all-time leaderboard.</Body>
				)}
				{profile && (
					<View style={styles.stats}>
						{t ? (
							<>
								<Stat label="Rank" value={stats?.rank ? `#${stats.rank}` : "—"} />
								<Stat label="Matches" value={t.matches} />
								<Stat label="Wins" value={t.wins} color={ui.ready} />
								<Stat label="Kills" value={t.kills} />
								<Stat label="Accuracy" value={`${Math.round(t.accuracy * 100)}%`} />
							</>
						) : (
							<Body size={13} color={ui.muted}>{statsError ?? (stats ? "No matches yet. Play one!" : "Loading your stats…")}</Body>
						)}
					</View>
				)}
			</View>

			<ScrollView style={styles.right} contentContainerStyle={styles.rightContent}>
				{profile ? (
					<>
						<SlantButton label="DONE" primary onPress={onDone} />
						<SlantButton label="SIGN OUT" onPress={() => account.signOut()} />
					</>
				) : (
					<>
						<ProviderButton provider="google" disabled={!authReady || busy} onPress={() => go("google")} />
						<ProviderButton provider="github" disabled={!authReady || busy} onPress={() => go("github")} />
						<SlantButton label={first ? "PLAY AS GUEST" : "BACK"} onPress={onDone} />
					</>
				)}
				{busy && <ActivityIndicator color={ui.ink} />}
				{!!error && <Body size={13} color={ui.gold}>{error}</Body>}
				{!profile && !authReady && (
					<Body size={13} color={ui.muted}>
						{configError ?? (config ? "Sign-in isn't set up on the server yet." : "Checking the server…")}
					</Body>
				)}
				<SlantButton label={settings ? "HIDE" : "WEBSITE ADDRESS"} small onPress={() => setSettings(!settings)} />
				{settings && (
					<View style={{ gap: 6 }}>
						<TextInput
							style={styles.input}
							defaultValue={account.apiUrl}
							onEndEditing={(e) => account.setApiUrl(e.nativeEvent.text)}
							onSubmitEditing={(e) => account.setApiUrl(e.nativeEvent.text)}
							autoCapitalize="none"
							autoCorrect={false}
							placeholder="https://skillissue.example"
							placeholderTextColor={ui.muted}
						/>
						<Body size={12} color={ui.muted}>The SkillIssue website (it runs the sign-in and stats API).</Body>
						<Eyebrow>Auth0 callback for this phone</Eyebrow>
						<Body size={12} color={ui.ink}>{redirectUri()}</Body>
						<Body size={12} color={ui.muted}>Add it to Allowed Callback URLs of "SkillIssue Native" if sign-in says the callback isn't allowed.</Body>
					</View>
				)}
			</ScrollView>
		</View>
	);
}

function ProviderButton({ provider, onPress, disabled }: { provider: Provider; onPress: () => void; disabled: boolean }) {
	const google = provider === "google";
	return (
		<SlantButton
			label={google ? "SIGN IN WITH GOOGLE" : "SIGN IN WITH GITHUB"}
			onPress={onPress}
			disabled={disabled}
			color={google ? "#FFFFFF" : "#0D1117"}
			textColor={google ? "#1F2433" : ui.ink}
			style={!google && { borderColor: "rgba(255,255,255,0.35)" }}
			icon={
				<View style={[styles.mark, { backgroundColor: google ? "#4285F4" : "#F2F5FF", transform: [{ skewX: "12deg" }] }]}>
					<Title size={13} color={google ? "#FFFFFF" : "#0D1117"}>{google ? "G" : "GH"}</Title>
				</View>
			}
		/>
	);
}

function Stat({ label, value, color = ui.ink }: { label: string; value: string | number; color?: string }) {
	return (
		<View style={styles.stat}>
			<Title size={24} color={color}>{value}</Title>
			<Eyebrow>{label}</Eyebrow>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, flexDirection: "row", padding: 24, gap: 24 },
	left: { flex: 1.25, justifyContent: "center", gap: 10 },
	wordmark: { flexDirection: "row", gap: 12 },
	me: { flexDirection: "row", alignItems: "center", gap: 14 },
	avatar: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: ui.line },
	stats: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 6 },
	stat: { minWidth: 70 },
	right: { flex: 1, maxWidth: 340 },
	rightContent: { flexGrow: 1, justifyContent: "center", gap: 12, paddingVertical: 8 },
	mark: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
	input: {
		fontFamily: fonts.bodySemi,
		fontSize: 16,
		color: ui.ink,
		backgroundColor: "rgba(7, 10, 18, 0.85)",
		borderColor: ui.line,
		borderWidth: 1.5,
		borderRadius: 6,
		paddingVertical: 8,
		paddingHorizontal: 12,
	},
});
