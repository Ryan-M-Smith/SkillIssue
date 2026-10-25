import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { Body, Eyebrow, SlantButton, SplitBackground, Title } from "./kit";
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
				<Eyebrow>2 v 2 · hold your phone sideways</Eyebrow>
				<View style={styles.wordmark}>
					<Title size={58} color={ui.blue}>SKILL</Title>
					<Title size={58} color={ui.red}>ISSUE</Title>
				</View>
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
						<Eyebrow>Server address</Eyebrow>
						<TextInput
							style={styles.input}
							value={serverUrl}
							onChangeText={onServerUrl}
							autoCapitalize="none"
							autoCorrect={false}
							placeholder="ws://192.168.1.20:8080"
							placeholderTextColor={ui.muted}
						/>
						<Body size={12} color={ui.muted}>Shown in the game's lobby, under the join code.</Body>
					</View>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, flexDirection: "row", padding: 24, gap: 24 },
	left: { flex: 1.3, justifyContent: "center", gap: 8 },
	wordmark: { flexDirection: "row", gap: 14 },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 },
	right: { flex: 1, justifyContent: "center", gap: 8, maxWidth: 320 },
	input: {
		fontFamily: fonts.bodySemi,
		fontSize: 18,
		color: ui.ink,
		backgroundColor: "rgba(7, 10, 18, 0.85)",
		borderColor: ui.line,
		borderWidth: 1.5,
		borderRadius: 6,
		paddingVertical: 9,
		paddingHorizontal: 12,
	},
});
