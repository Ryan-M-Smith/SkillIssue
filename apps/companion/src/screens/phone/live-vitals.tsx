import { StyleSheet, Text, View } from "react-native";
import type { ControllerFeedback } from "@/service/lobby-client";
import { fonts, ui } from "./theme";

export function LiveVitals({ feedback, color = ui.blue }: { feedback: ControllerFeedback | null; color?: string }) {
	const fraction = feedback ? Math.max(0, Math.min(1, feedback.hp / Math.max(1, feedback.max_hp))) : 0;
	const barColor = fraction < 0.3 ? ui.red : fraction < 0.6 ? ui.gold : ui.ready;
	return <View style={styles.root}>
		<View style={styles.labels}><Text style={[styles.label, { color: feedback?.alive === false ? ui.red : color }]}>{feedback?.alive === false ? "REBUILDING…" : "VITALS"}</Text><Text style={styles.value}>{feedback ? `${feedback.hp} / ${feedback.max_hp}` : "WAITING FOR HOST"}</Text></View>
		<View style={styles.track}><View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: barColor }]} /></View>
	</View>;
}

const styles = StyleSheet.create({
	root: { gap: 5 },
	labels: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
	label: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.3 },
	value: { fontFamily: fonts.bodySemi, fontSize: 12, color: ui.ink },
	track: { height: 6, borderRadius: 3, backgroundColor: ui.panel2, overflow: "hidden" },
	fill: { height: "100%", borderRadius: 3 },
});
