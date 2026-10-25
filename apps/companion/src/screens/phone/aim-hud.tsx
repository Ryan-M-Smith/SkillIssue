import { Pressable, StyleSheet, Text, View } from "react-native";

import type { GameControls } from "@/types/motion";
import type { LobbyView } from "@/service/lobby-client";
import { Body, Eyebrow, Panel, SlantButton } from "./kit";
import { MatchBar } from "./match-bar";
import { LiveVitals } from "./live-vitals";
import { fonts, teamColor, teamTint, ui } from "./theme";

const weapons = ["PISTOL", "SHOTGUN", "SNIPER"];
/**
 * The gunner's phone. Turning the phone moves the camera (gyro only); everything
 * else is a button: hold FIRE, toggle AIM (scope), RELOAD, SWITCH gun.
 */
export function AimHud({ view, controls, weapon, firing = false, onFire, onAim, onReload, onSwitch, onRecalibrate }: {
	view: LobbyView;
	controls: GameControls;
	weapon: number;
	firing?: boolean;
	onFire: (down: boolean) => void;
	onAim: () => void;
	onReload: () => void;
	onSwitch: () => void;
	onRecalibrate?: () => void;
}) {
	const team = view.me?.teamId ?? 1;
	const color = teamColor(team);
	const feedback = view.feedback;
	const reloadProgress = Math.max(0, Math.min(1, feedback?.reload_progress ?? 0));
	const scoped = !!feedback?.scoped;
	return (
		<View style={styles.screen}>
			<MatchBar view={view} role="Gunner · turn to aim" calibrated={controls.ready} />
			<View style={styles.row}>
				<Panel border={color} fill={teamTint(team, 0.08)} style={styles.scope}>
					<View style={styles.scopeTop}>
						<Eyebrow color={color}>GYRO LINK</Eyebrow>
						<Eyebrow color={controls.ready ? ui.ready : ui.gold}>{controls.ready ? "LIVE" : "HOLD STILL"}</Eyebrow>
					</View>
					<View style={styles.reticle}>
						<View style={[styles.ring, { borderColor: firing ? ui.gold : color }]} />
						<View style={styles.crossH} />
						<View style={styles.crossV} />
						<View style={[styles.dot, { backgroundColor: color, transform: [{ translateX: controls.lookX * 50 }, { translateY: -controls.lookY * 50 }] }]} />
					</View>
					<Text style={[styles.action, { color: firing ? ui.gold : ui.ink }]}>{firing ? "FIRING" : controls.ready ? "TURN THE PHONE TO AIM" : "HOLD STILL"}</Text>
					<Body color={ui.muted} size={12} style={styles.center}>The camera turns exactly as far as your phone does.</Body>
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
					<View style={styles.buttons}>
						<View style={styles.smallButtons}>
							{/* Only the sniper has a scope to aim down. */}
							<SlantButton label={scoped ? "AIMING" : weapon === 2 ? "AIM" : "AIM · SNIPER"} small color={scoped ? color : undefined} disabled={weapon !== 2 && !scoped} onPress={onAim} style={styles.small} />
							<SlantButton label="RELOAD" small onPress={onReload} disabled={!!feedback?.reloading} style={styles.small} />
							<SlantButton label="SWITCH" small onPress={onSwitch} style={styles.small} />
						</View>
						<Pressable
							onPressIn={() => onFire(true)}
							onPressOut={() => onFire(false)}
							accessibilityRole="button"
							accessibilityLabel="Fire"
							style={[styles.fire, { borderColor: color, backgroundColor: firing ? color : teamTint(team, 0.25) }]}
						>
							<Text style={[styles.fireText, { color: firing ? ui.bg : ui.ink }]}>FIRE</Text>
						</Pressable>
					</View>
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
	buttons: { flex: 1, flexDirection: "row", gap: 10, minHeight: 90 },
	smallButtons: { flex: 1, justifyContent: "space-between", gap: 6 },
	small: { flex: 1 },
	fire: { flex: 1.15, borderWidth: 2, borderRadius: 14, alignItems: "center", justifyContent: "center" },
	fireText: { fontFamily: fonts.display, fontSize: 26, letterSpacing: 2 },
	recenter: { alignSelf: "flex-end" },
});
