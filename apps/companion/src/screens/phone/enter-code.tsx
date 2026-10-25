import { StyleSheet, TextInput, View } from "react-native";

import { Body, Eyebrow, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, ui } from "./theme";

export const codeLength = 6;

export function EnterCode({ code, onCode, onJoin, onBack, busy, error }: {
	code: string;
	onCode: (code: string) => void;
	onJoin: () => void;
	onBack: () => void;
	busy: boolean;
	error?: string | null;
}) {
	const valid = code.trim().length >= codeLength;
	return (
		<View style={styles.screen}>
			<SplitBackground />
			<View style={styles.head}>
				<View>
					<Eyebrow>Join your squad</Eyebrow>
					<Title size={30}>ENTER YOUR LOBBY</Title>
				</View>
				<SlantButton label={busy ? "CANCEL" : "BACK"} small onPress={onBack} />
			</View>
			<View style={styles.entry}>
				<Eyebrow>Lobby code</Eyebrow>
				<TextInput
					value={code}
					onChangeText={onCode}
					autoFocus
					autoCapitalize="characters"
					autoCorrect={false}
					editable={!busy}
					maxLength={7}
					placeholder="ABC123"
					placeholderTextColor={ui.muted}
					accessibilityLabel="Lobby code"
					returnKeyType="go"
					style={styles.input}
					onSubmitEditing={() => valid && !busy && onJoin()}
				/>
				<Body size={14} color={ui.muted}>The 6-character code on the game screen.</Body>
			</View>
			<View style={styles.foot}>
				<Body size={14} color={error ? ui.red : ui.muted} style={{ flex: 1 }}>
					{error ?? (busy ? "Joining your lobby…" : "Pick a team and role after joining, then ready up.")}
				</Body>
				<SlantButton label={busy ? "JOINING…" : error ? "RETRY" : "JOIN"} primary disabled={busy || !valid} onPress={onJoin} style={{ minWidth: 160 }} />
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 24, justifyContent: "space-between", gap: 12 },
	head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
	entry: { gap: 10, alignSelf: "center", width: "100%", maxWidth: 700 },
	input: { fontFamily: fonts.displaySemi, fontSize: 24, color: ui.ink, borderWidth: 2, borderColor: ui.blue, borderRadius: 8, backgroundColor: ui.panel, paddingHorizontal: 18, paddingVertical: 12 },
	foot: { flexDirection: "row", alignItems: "center", gap: 16 },
});
