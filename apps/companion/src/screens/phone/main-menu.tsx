import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { Body, Eyebrow, Script, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, ui } from "./theme";

export function MainMenu({
	name,
	onName,
	serverUrl,
	onServerUrl,
	onJoin,
	onPractice,
	notice,
}: {
	name: string;
	onName: (name: string) => void;
	serverUrl: string;
	onServerUrl: (url: string) => void;
	onJoin: () => void;
	onPractice: () => void;
	notice?: string | null;
}) {
	const [settings, setSettings] = useState(false);
	return (
		<View style={styles.screen}>
			<SplitBackground split={0.62} />
			<View style={styles.left}>
				<Script size={20}>HackPSU Fall 2026 presents</Script>
				<View style={styles.wordmark}>
					<Title size={58} depth={0.1}>SKILL ISSUE</Title>
				</View>
				<View style={styles.teamMarks}>
					<View style={[styles.mark, { backgroundColor: ui.blue }]} />
					<View style={[styles.mark, { backgroundColor: ui.red }]} />
				</View>
				<Eyebrow>2 v 2 · hold your phone sideways</Eyebrow>
				<Body size={16} color={ui.ink}>One of you moves. One of you shoots.</Body>
				{!!notice && <Body size={14} color={ui.gold}>{notice}</Body>}
				<View style={styles.buttons}>
					<SlantButton label="JOIN A LOBBY" primary onPress={onJoin} style={{ minWidth: 220 }} />
					<SlantButton label="PRACTICE CONTROLS" onPress={onPractice} style={{ minWidth: 220 }} />
				</View>
			</View>
			<View style={styles.right}>
				<Eyebrow>Your name</Eyebrow>
				<TextInput
					style={styles.input}
					value={name}
					onChangeText={(t) => onName(t.slice(0, 16))}
					placeholder="Player"
					placeholderTextColor={ui.muted}
					autoCorrect={false}
					maxLength={16}
				/>
				<SlantButton label={settings ? "HIDE SETTINGS" : "SETTINGS"} small onPress={() => setSettings(!settings)} />
				{settings && (
					<View style={{ gap: 6 }}>
						<Eyebrow>Practice debug stream</Eyebrow>
						<TextInput
							style={styles.input}
							value={serverUrl}
							onChangeText={onServerUrl}
							autoCapitalize="none"
							autoCorrect={false}
							placeholder="ws://192.168.1.20:8080"
							placeholderTextColor={ui.muted}
						/>
						<Body size={12} color={ui.muted}>Only for streaming Practice motion to the web debugger. Lobbies are found automatically.</Body>
					</View>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, flexDirection: "row", padding: 24, gap: 24 },
	left: { flex: 1.3, justifyContent: "center", gap: 8 },
	wordmark: { flexDirection: "row" },
	teamMarks: { flexDirection: "row", gap: 6, marginBottom: 4 },
	mark: { width: 44, height: 3 },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 },
	right: { flex: 1, justifyContent: "center", gap: 8, maxWidth: 320 },
	input: {
		fontFamily: fonts.bodySemi,
		fontSize: 18,
		color: ui.ink,
		backgroundColor: "rgba(8, 8, 8, 0.85)",
		borderColor: ui.line,
		borderWidth: 1,
		borderRadius: 0,
		paddingVertical: 9,
		paddingHorizontal: 12,
	},
});
