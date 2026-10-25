import { Pressable, StyleSheet, Text, View } from "react-native";

import type { GameControls } from "@/types/motion";
import type { LobbyView } from "@/service/lobby-client";
import { Eyebrow, SlantButton } from "./kit";
import { MatchBar } from "./match-bar";
import { fonts, teamColor, teamTint, ui } from "./theme";

const weapons = ["PISTOL", "SHOTGUN", "SNIPER"];

export function AimHud({
	view,
	controls,
	weapon,
	firing,
	onFire,
	onScope,
	onWeapon,
}: {
	view: LobbyView;
	controls: GameControls;
	weapon: number;
	firing: boolean;
	onFire: (down: boolean) => void;
	onScope: () => void;
	onWeapon: (slot: number) => void;
}) {
	const team = view.me?.teamId ?? 1;
	const color = teamColor(team);
	return (
		<View style={styles.screen}>
			<MatchBar view={view} role="Aim phone" calibrated={controls.ready} />
			<View style={styles.row}>
				<View style={[styles.scope, { borderColor: color, backgroundColor: teamTint(team, 0.08) }]}>
					<View style={[styles.crossH, { backgroundColor: ui.line }]} />
					<View style={[styles.crossV, { backgroundColor: ui.line }]} />
					<View style={[styles.dot, { backgroundColor: color, transform: [{ translateX: controls.lookX * 60 }, { translateY: -controls.lookY * 60 }] }]} />
					<Text style={styles.scopeHint}>Turn the phone to look · jab forward to shoot</Text>
				</View>
				<View style={styles.side}>
					<Eyebrow>Weapon</Eyebrow>
					<View style={styles.weapons}>
						{weapons.map((w, i) => (
							<SlantButton key={w} label={w} small color={weapon === i ? color : undefined} onPress={() => onWeapon(i)} style={{ flexGrow: 1 }} />
						))}
					</View>
					<SlantButton label="SCOPE" small onPress={onScope} />
					<Pressable
						onPressIn={() => onFire(true)}
						onPressOut={() => onFire(false)}
						style={[styles.fire, { borderColor: color, backgroundColor: firing ? color : teamTint(team, 0.35) }]}
					>
						<Text style={styles.fireText}>FIRE</Text>
						<Text style={styles.fireHint}>hold</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 12, gap: 10 },
	row: { flex: 1, flexDirection: "row", gap: 12 },
	scope: { flex: 1.2, borderWidth: 1.5, borderRadius: 12, alignItems: "center", justifyContent: "center", overflow: "hidden" },
	crossH: { position: "absolute", left: "10%", right: "10%", height: 1.5 },
	crossV: { position: "absolute", top: "12%", bottom: "12%", width: 1.5 },
	dot: { width: 18, height: 18, borderRadius: 9 },
	scopeHint: { position: "absolute", bottom: 8, fontFamily: fonts.body, fontSize: 12, color: ui.muted },
	side: { flex: 1, gap: 8 },
	weapons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	fire: { flex: 1, borderWidth: 2, borderRadius: 14, alignItems: "center", justifyContent: "center" },
	fireText: { fontFamily: fonts.display, fontSize: 40, color: ui.ink, letterSpacing: 2 },
	fireHint: { fontFamily: fonts.bodyBold, fontSize: 11, color: ui.muted, letterSpacing: 1 },
});
