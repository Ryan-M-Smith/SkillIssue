import { useRef, type ComponentRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Body, Eyebrow, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, ui } from "./theme";

export const codeLength = 6;
const allowed = /[^A-Z0-9]/g;

export function EnterCode({
	code,
	onCode,
	onJoin,
	onBack,
	busy,
	error,
}: {
	code: string;
	onCode: (code: string) => void;
	onJoin: () => void;
	onBack: () => void;
	busy: boolean;
	error?: string | null;
}) {
	const input = useRef<ComponentRef<typeof TextInput>>(null);
	const chars = code.padEnd(codeLength, " ").slice(0, codeLength).split("");
	return (
		<View style={styles.screen}>
			<SplitBackground />
			<View style={styles.head}>
				<View>
					<Eyebrow>Join a lobby</Eyebrow>
					<Title size={30}>ENTER THE CODE</Title>
				</View>
				<SlantButton label="BACK" small onPress={onBack} />
			</View>
			<Pressable style={styles.boxes} onPress={() => input.current?.focus()}>
				{chars.map((c, i) => (
					<View key={i} style={[styles.box, { borderColor: i < 3 ? ui.blue : ui.red }, i === code.length && styles.boxCursor]}>
						<Text style={styles.char}>{c.trim()}</Text>
					</View>
				))}
			</Pressable>
			<TextInput
				ref={input}
				value={code}
				onChangeText={(t) => onCode(t.toUpperCase().replace(allowed, "").slice(0, codeLength))}
				autoFocus
				autoCapitalize="characters"
				autoCorrect={false}
				maxLength={codeLength}
				style={styles.hidden}
				onSubmitEditing={() => code.length === codeLength && onJoin()}
			/>
			<View style={styles.foot}>
				<Body size={14} color={error ? ui.red : ui.muted} style={{ flex: 1 }}>
					{error ?? "It's on the game screen: six letters and numbers."}
				</Body>
				<SlantButton label={busy ? "JOINING…" : "JOIN"} primary disabled={busy || code.length !== codeLength} onPress={onJoin} style={{ minWidth: 160 }} />
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 24, justifyContent: "space-between" },
	head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
	boxes: { flexDirection: "row", justifyContent: "center", gap: 10 },
	box: { width: 64, height: 80, borderWidth: 2, borderRadius: 8, backgroundColor: "rgba(7, 10, 18, 0.9)", alignItems: "center", justifyContent: "center" },
	boxCursor: { borderColor: ui.ink },
	char: { fontFamily: fonts.display, fontSize: 44, color: ui.ink },
	hidden: { position: "absolute", opacity: 0, width: 1, height: 1 },
	foot: { flexDirection: "row", alignItems: "center", gap: 16 },
});
