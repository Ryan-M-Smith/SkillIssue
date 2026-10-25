import { StyleSheet, Text, View } from "react-native";

import type { GameControls } from "@/types/motion";
import type { LobbyView } from "@/service/lobby-client";
import { Body, Eyebrow, Panel, SlantButton } from "./kit";
import { MatchBar } from "./match-bar";
import { LiveVitals } from "./live-vitals";
import { fonts, teamColor, teamTint, ui } from "./theme";

const weapons = ["PISTOL", "SHOTGUN", "SNIPER"];
const gestures = [
	["→", "JAB FORWARD", "Fire a shot"],
	["↑", "LIFT UP", "Reload the magazine"],
	["↻", "TWIST 32°", "Next weapon · return to center"],
	["←", "PULL BACK", "Toggle scope"],
];

export function AimHud({ view, controls, weapon, firing = false, onRecalibrate }: {
	view: LobbyView;
	controls: GameControls;
	weapon: number;
	firing?: boolean;
	onRecalibrate?: () => void;
}) {
	const team = view.me?.teamId ?? 1;
	const color = teamColor(team);
	const feedback = view.feedback;
	const reloadProgress = Math.max(0, Math.min(1, feedback?.reload_progress ?? 0));
	const action = controls.action === "weapon_next" ? "WEAPON SWITCH" : controls.action?.toUpperCase();
	return (
		<View style={styles.screen}>
			<MatchBar view={view} role="Aim phone · motion control" calibrated={controls.ready} />
			<View style={styles.row}>
				<Panel border={color} fill={teamTint(team, 0.08)} style={styles.scope}>
					<View style={styles.scopeTop}>
						<Eyebrow color={color}>GYRO LINK</Eyebrow>
						<Eyebrow color={controls.ready ? ui.ready : ui.gold}>{controls.ready ? "LIVE" : "HOLD STILL"}</Eyebrow>
					</View>
					<View style={styles.reticle}>
						<View style={[styles.ring, { borderColor: firing || controls.action === "shoot" ? ui.gold : color }]} />
						<View style={styles.crossH} />
						<View style={styles.crossV} />
						<View style={[styles.dot, { backgroundColor: color, transform: [{ translateX: controls.lookX * 50 }, { translateY: -controls.lookY * 50 }] }]} />
					</View>
					<Text style={[styles.action, { color: action ? ui.gold : ui.ink }]}>{action ?? (controls.ready ? "AIM WITH YOUR PHONE" : "FIND YOUR NEUTRAL")}</Text>
					<Body color={ui.muted} size={12} style={styles.center}>Turn to aim. Small, deliberate gestures control your kit.</Body>
				</Panel>
				<Panel style={styles.side}>
					<View style={styles.weaponHeader}>
						<View style={[styles.weaponIcon, { borderColor: color }]}><View style={[styles.barrel, { backgroundColor: color, width: weapon === 2 ? 38 : 26 }]} /><View style={[styles.grip, { backgroundColor: color }]} /></View>
						<View><Eyebrow>ACTIVE KIT</Eyebrow><Text style={styles.weapon}>{weapons[weapon] ?? weapons[0]}</Text></View>
						<View style={styles.ammoBlock}><Text style={[styles.ammo, feedback && feedback.ammo <= 2 && { color: ui.red }]}>{feedback?.ammo ?? "–"}<Text style={styles.magSize}> / {feedback?.magazine_size ?? "–"}</Text></Text><Eyebrow>{feedback?.scoped ? "SCOPED" : "MAGAZINE"}</Eyebrow></View>
					</View>
					{feedback?.reloading && <View style={styles.reloadRow}>
						<View style={styles.reloadRing}>{Array.from({ length: 12 }, (_, index) => <View key={index} style={[styles.reloadSegment, { backgroundColor: index < Math.ceil(reloadProgress * 12) ? ui.gold : ui.line, transform: [{ rotate: `${index * 30}deg` }, { translateY: -12 }] }]} />)}<Text style={styles.reloadPercent}>{Math.round(reloadProgress * 100)}</Text></View>
						<Eyebrow color={ui.gold}>RELOADING</Eyebrow>
					</View>}
					{gestures.map(([icon, label, hint]) => <View style={styles.gesture} key={label}>
						<Text style={[styles.gestureIcon, { color }]}>{icon}</Text>
						<View style={styles.gestureText}><Eyebrow color={ui.ink}>{label}</Eyebrow><Body size={12} color={ui.muted}>{hint}</Body></View>
					</View>)}
					<LiveVitals feedback={feedback} color={color} />
					{onRecalibrate && <SlantButton label="RECENTER" small onPress={onRecalibrate} style={styles.recenter} />}
				</Panel>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 12, gap: 10 },
	row: { flex: 1, flexDirection: "row", gap: 12 },
	scope: { flex: 1.2, alignItems: "center", justifyContent: "space-between", overflow: "hidden", gap: 6 },
	scopeTop: { alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between" },
	reticle: { flex: 1, minHeight: 65, width: "100%", alignItems: "center", justifyContent: "center" },
	ring: { width: 86, height: 86, borderRadius: 43, borderWidth: 2, position: "absolute", opacity: 0.6 },
	crossH: { position: "absolute", left: "15%", right: "15%", height: 1, backgroundColor: ui.line },
	crossV: { position: "absolute", top: "5%", bottom: "5%", width: 1, backgroundColor: ui.line },
	dot: { width: 12, height: 12, borderRadius: 6 },
	action: { fontFamily: fonts.display, fontSize: 18, textAlign: "center", letterSpacing: 1 },
	center: { textAlign: "center" },
	side: { flex: 1, justifyContent: "space-between", gap: 8 },
	weaponHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 8, borderBottomWidth: 1, borderColor: ui.line },
	weapon: { fontFamily: fonts.display, fontSize: 22, color: ui.ink },
	ammoBlock: { marginLeft: "auto", alignItems: "flex-end" },
	ammo: { fontFamily: fonts.display, fontSize: 24, color: ui.ink },
	magSize: { fontFamily: fonts.body, fontSize: 14, color: ui.muted },
	reloadRow: { flexDirection: "row", gap: 10, alignItems: "center" },
	reloadRing: { height: 32, width: 32, alignItems: "center", justifyContent: "center" },
	reloadSegment: { position: "absolute", height: 4, width: 3, borderRadius: 1 },
	reloadPercent: { fontFamily: fonts.bodyBold, color: ui.gold, fontSize: 9 },
	weaponIcon: { width: 48, height: 38, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center" },
	barrel: { height: 7, marginTop: -5 },
	grip: { width: 8, height: 12, marginRight: 14, transform: [{ skewX: "-16deg" }] },
	gesture: { flexDirection: "row", alignItems: "center", gap: 10 },
	gestureIcon: { width: 28, textAlign: "center", fontSize: 25, fontFamily: fonts.display },
	gestureText: { flex: 1, gap: 1 },
	recenter: { alignSelf: "flex-end" },
});
