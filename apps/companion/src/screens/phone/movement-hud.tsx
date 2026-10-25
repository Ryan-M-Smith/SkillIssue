import { StyleSheet, Text, View } from "react-native";

import type { Counts, Direction, MovementState } from "@/lib/motion-summary";
import type { GameControls } from "@/types/motion";
import type { LobbyView } from "@/service/lobby-client";
import { Eyebrow, Panel, Script, SlantButton, SplitBackground } from "./kit";
import { MatchBar } from "./match-bar";
import { LiveVitals } from "./live-vitals";
import { fonts, teamColor, ui } from "./theme";

const stateColor: Record<MovementState, string> = {
	// Noir: off-white type; only calibrating is dimmed.
	Calibrating: ui.muted,
	Standing: ui.ink,
	Walking: ui.ink,
	Sprinting: ui.gold,
	Crouching: ui.soft,
	"Crouch-walking": ui.soft,
	Jumping: ui.gold,
};

const countLabels: [keyof Counts, string][] = [
	["jumps", "JUMPS"],
	["crouches", "CROUCHES"],
	["sprints", "SPRINTS"],
	["movements", "MOVES"],
];

export function MovementHud({
	view,
	controls,
	state,
	direction,
	counts,
	onRecalibrate,
}: {
	view: LobbyView;
	controls: GameControls;
	state: MovementState;
	direction: Direction;
	counts: Counts;
	onRecalibrate?: () => void;
}) {
	const team = view.me?.teamId ?? 1;
	return (
		<View style={styles.screen}>
			<SplitBackground />
			<MatchBar view={view} role="Runner · movement phone" calibrated={controls.ready} />
			<View style={styles.row}>
				<Panel style={[styles.main, { borderLeftWidth: 4, borderLeftColor: teamColor(team) }]}>
					<Script size={18}>right now…</Script>
					<Text style={[styles.state, { color: stateColor[state] }]} numberOfLines={1} adjustsFontSizeToFit>{state}</Text>
					<View style={styles.dirRow}>
						<Text style={styles.arrow}>{direction.arrow}</Text>
						<Text style={styles.dir}>{direction.label}</Text>
					</View>
					<LiveVitals feedback={view.feedback} color={teamColor(team)} />
					<View style={styles.flags}>
						<Text style={[styles.flag, controls.crouch && styles.flagOn]}>CROUCH</Text>
						<Text style={[styles.flag, controls.sprint && styles.flagOn]}>SPRINT</Text>
					</View>
				</Panel>
				<View style={styles.counts}>
					{countLabels.map(([key, label]) => (
						<Panel key={key} style={styles.tile}>
							<Text style={styles.tileValue}>{counts[key]}</Text>
							<Eyebrow>{label}</Eyebrow>
						</Panel>
					))}
				</View>
			</View>
			<View style={styles.footer}>
				<Text style={[styles.hint, { flex: 1 }]}>Tilt to walk · tip to strafe · flick forward crouch · flick back jump · twist 30° to toggle sprint, then center</Text>
				{onRecalibrate && <SlantButton label="RECENTER" small onPress={onRecalibrate} />}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 12, gap: 10 },
	row: { flex: 1, flexDirection: "row", gap: 10 },
	main: { flex: 1.3, justifyContent: "space-between" },
	state: { fontFamily: fonts.display, fontSize: 46, color: ui.ink, textShadowColor: "#2A2A2A", textShadowOffset: { width: 3, height: 4 }, textShadowRadius: 0 },
	dirRow: { flexDirection: "row", alignItems: "center", gap: 12 },
	arrow: { fontFamily: fonts.display, fontSize: 44, width: 48, textAlign: "center", color: ui.ink },
	dir: { fontFamily: fonts.displaySemi, fontSize: 22, color: ui.ink },
	flags: { flexDirection: "row", gap: 8 },
	flag: { flex: 1, textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: ui.muted, borderWidth: 1.5, borderColor: ui.line, borderRadius: 12, paddingVertical: 5, overflow: "hidden" },
	flagOn: { color: ui.bg, backgroundColor: ui.ready, borderColor: ui.ready },
	counts: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, alignContent: "stretch" },
	tile: { flexBasis: "45%", flexGrow: 1, justifyContent: "center" },
	tileValue: { fontFamily: fonts.display, fontSize: 30, color: ui.ink },
	hint: { fontFamily: fonts.body, fontSize: 12, color: ui.muted, textAlign: "center" },
	footer: { flexDirection: "row", alignItems: "center", gap: 12 },
});
