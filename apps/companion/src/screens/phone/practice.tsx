import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { DeviceMotion } from "expo-sensors";

import { MotionController, emptyControls } from "@/service/motion-control-service";
import { DebugLink, idleLinkStatus, type DebugLinkStatus } from "@/service/debug-link";
import { MotionTally, directionOf, zeroCounts, type Counts, type MovementState } from "@/lib/motion-summary";
import { defaultDebugRoom } from "@/lib/net/server-url";
import type { Action, GameControls, Grip, Role } from "@/types/motion";
import { Body, Eyebrow, Panel, SlantButton, SplitBackground, Title } from "./kit";
import { fonts, ui } from "./theme";

const movementGuide = [
	["↕", "TILT TO MOVE", "Tilt 5–20° forward or back. Return to center to stop."],
	["↔", "TIP TO STRAFE", "Tip one end down slightly to move sideways."],
	["↻", "32° WHEEL TWIST", "Toggle sprint with a gentle twist. Center before twisting again."],
	["↑", "FLICK BACK", "A short, quick flick toward you jumps or stands up."],
	["↓", "FLICK FORWARD", "A short flick away toggles crouch."],
];
const gunnerGuide = [
	["◎", "TURN TO AIM", "Small, smooth turns steer the camera."],
	["→", "JAB FORWARD", "A short push away fires. Relax briefly between shots."],
	["↑", "LIFT TO RELOAD", "Lift the phone straight up to reload."],
	["↻", "32° WHEEL TWIST", "Cycle weapons. Return to center before the next switch."],
	["←", "PULL BACK", "A short pull toward you toggles the scope."],
];
const movementStats: [keyof Counts, string][] = [["jumps", "JUMPS"], ["crouches", "CROUCHES"], ["sprints", "SPRINTS"], ["movements", "MOVES"]];
const freshActions = { shoot: 0, reload: 0, weapon_next: 0, scope: 0 };
const actionNames: Partial<Record<Exclude<Action, null>, string>> = { weapon_next: "WEAPON SWITCH", shoot: "SHOT", reload: "RELOAD", scope: "SCOPE" };
const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Both roles use the same calibrated model as the live match. */
export function Practice({ serverUrl, onBack }: { serverUrl: string; onBack: () => void }) {
	const [role, setRole] = useState<Role>("movement");
	const [controls, setControls] = useState<GameControls>(emptyControls);
	const [counts, setCounts] = useState<Counts>(zeroCounts);
	const [actions, setActions] = useState(freshActions);
	const [state, setState] = useState<MovementState>("Calibrating");
	const [grip, setGrip] = useState<Grip | null>(null);
	const [lastAction, setLastAction] = useState("FIND YOUR NEUTRAL");
	const [sensorError, setSensorError] = useState("");
	const [sensorSession, setSensorSession] = useState(0);
	const [room, setRoom] = useState(defaultDebugRoom);
	const [debug, setDebug] = useState<DebugLinkStatus>(idleLinkStatus);
	const [debugOn, setDebugOn] = useState(false);
	const [showDebug, setShowDebug] = useState(false);
	const { width, height } = useWindowDimensions();
	const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
	const compact = !hydrated || width < height || width < 600;
	const controllerRef = useRef(new MotionController("movement", Platform.OS));
	const tallyRef = useRef(new MotionTally());
	const debugRef = useRef<DebugLink | null>(null);
	const lastDrawRef = useRef(0);

	useEffect(() => {
		let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;
		let cancelled = false;
		(async () => {
			try {
				const permission = await DeviceMotion.requestPermissionsAsync();
				if (!permission.granted) throw new Error("Allow motion access in your phone’s settings, then reopen practice.");
				if (!(await DeviceMotion.isAvailableAsync())) throw new Error("This device has no motion sensors. Use a phone to practice.");
				if (cancelled) return;
				DeviceMotion.setUpdateInterval(20);
				subscription = DeviceMotion.addListener((reading) => {
					const now = Date.now();
					const output = controllerRef.current.process(reading, now);
					tallyRef.current.add(output, now);
					debugRef.current?.sendReading(reading);
					if (output.action) {
						const action = output.action;
						setLastAction(actionNames[action] ?? action.toUpperCase());
						if (action in freshActions) setActions(previous => ({ ...previous, [action]: previous[action as keyof typeof freshActions] + 1 }));
					}
					if (now - lastDrawRef.current >= 50 || output.action) {
						lastDrawRef.current = now;
						setControls(output);
						setCounts({ ...tallyRef.current.counts });
						setState(tallyRef.current.state(output, now));
						setGrip(output.ready ? controllerRef.current.getDebug().grip : null);
					}
				});
			} catch (e) {
				if (!cancelled) setSensorError(Platform.OS === "web" ? "Tap RECENTER to allow motion. Use HTTPS and a phone with motion sensors." : e instanceof Error ? e.message : String(e));
			}
		})();
		return () => { cancelled = true; subscription?.remove(); };
	}, [sensorSession]);
	useEffect(() => () => { debugRef.current?.close(); }, []);

	function resetCounts() {
		tallyRef.current.reset();
		setCounts({ ...zeroCounts });
		setActions({ ...freshActions });
		setLastAction("FIND YOUR NEUTRAL");
		debugRef.current?.sendEvent("reset_counts");
	}
	function recalibrate() {
		controllerRef.current.reset();
		setControls({ ...emptyControls });
		setState("Calibrating");
		setGrip(null);
		setLastAction("HOLD STILL FOR A MOMENT");
		debugRef.current?.sendEvent("recalibrate");
		// Mobile browsers require requesting permission directly from this tap.
		void DeviceMotion.requestPermissionsAsync().then(permission => {
			if (permission.granted) { setSensorError(""); setSensorSession(session => session + 1); }
			else setSensorError("Allow motion access in your phone’s browser settings, then tap RECENTER.");
		}).catch(() => setSensorError("Motion sensors are unavailable. Open the native phone app or use HTTPS."));
	}
	function pickRole(next: Role) {
		if (next === role) return;
		setRole(next);
		controllerRef.current = new MotionController(next, Platform.OS);
		resetCounts();
		setControls({ ...emptyControls });
		setState("Calibrating");
		setGrip(null);
	}
	function toggleDebug() {
		if (debugRef.current) {
			debugRef.current.close(); debugRef.current = null;
			setDebugOn(false); setDebug(idleLinkStatus); return;
		}
		const link = new DebugLink(serverUrl.trim(), room.trim() || defaultDebugRoom, "phone", Platform.OS, {
			onStatus: setDebug,
			onEvent: event => {
				if (event === "recalibrate") controllerRef.current.reset();
				if (event === "reset_counts") { tallyRef.current.reset(); setCounts({ ...zeroCounts }); setActions({ ...freshActions }); }
			},
		});
		debugRef.current = link; setDebugOn(true); link.open();
	}
	const direction = directionOf(controls);
	const guide = role === "movement" ? movementGuide : gunnerGuide;
	const stats: [string, number][] = role === "movement"
		? movementStats.map(([key, label]) => [label, counts[key]])
		: [["SHOTS", actions.shoot], ["RELOADS", actions.reload], ["SWITCHES", actions.weapon_next], ["SCOPES", actions.scope]];
	return (
		<View style={styles.screen}>
			<SplitBackground split={0.6} />
			<View style={styles.header}>
				<View><Eyebrow color={ui.gold}>NO LOBBY NEEDED</Eyebrow><Title size={25}>THE WARMUP</Title></View>
				<SlantButton label="BACK TO MENU" small onPress={onBack} />
			</View>
			<ScrollView contentContainerStyle={[styles.content, compact && styles.stack]} keyboardShouldPersistTaps="handled">
				<Panel border={controls.ready ? ui.blue : ui.gold} style={[styles.live, compact && styles.stackedPanel]}>
					<View style={styles.roleRow}>
						<SlantButton label="MOVEMENT" small color={role === "movement" ? ui.blue : undefined} onPress={() => pickRole("movement")} style={styles.grow} />
						<SlantButton label="GUNNER" small color={role === "gunner" ? ui.red : undefined} onPress={() => pickRole("gunner")} style={styles.grow} />
						<SlantButton label="RECENTER" small onPress={recalibrate} style={styles.grow} />
					</View>
					<Eyebrow color={controls.ready ? ui.ready : ui.gold}>{controls.ready ? `SENSORS LIVE · ${grip ?? "READY"}` : "HOLD STILL AT A COMFORTABLE ANGLE"}</Eyebrow>
					{role === "movement" ? <>
						<Text style={[styles.state, { color: controls.sprint ? ui.ready : controls.crouch ? ui.gold : ui.ink }]} numberOfLines={1} adjustsFontSizeToFit>{state}</Text>
						<View style={styles.direction}><Text style={styles.arrow}>{direction.arrow}</Text><Body size={20}>{direction.label}</Body></View>
						<View style={styles.track}><View style={[styles.trackFill, { width: `${Math.min(1, Math.hypot(controls.moveX, controls.moveY)) * 100}%` }]} /></View>
					</> : <>
						<View style={styles.target}><View style={styles.crossH} /><View style={styles.crossV} /><View style={[styles.dot, { transform: [{ translateX: controls.lookX * 65 }, { translateY: -controls.lookY * 45 }] }]} /></View>
						<Text style={styles.lastAction}>{controls.ready ? lastAction : "FIND YOUR NEUTRAL"}</Text>
					</>}
					{!!sensorError && <Body color={ui.red} size={13}>{sensorError}</Body>}
					<View style={styles.stats}>{stats.map(([label, value]) => <View style={styles.stat} key={label}><Text style={styles.statValue}>{value}</Text><Eyebrow>{label}</Eyebrow></View>)}</View>
					<SlantButton label="RESET STATS" small onPress={resetCounts} />
				</Panel>
				<Panel style={[styles.guide, compact && styles.stackedPanel]}>
					<Eyebrow color={ui.gold}>YOUR PHONE IS THE CONTROLLER</Eyebrow>
					<Body color={ui.muted} size={13}>Hold it sideways, screen toward you. Start with small motions. Recenter whenever your grip changes.</Body>
					{guide.map(([icon, title, hint]) => <View style={styles.guideRow} key={title}><Text style={styles.guideIcon}>{icon}</Text><View style={styles.grow}><Eyebrow color={ui.ink}>{title}</Eyebrow><Body size={12} color={ui.muted}>{hint}</Body></View></View>)}
					<SlantButton label={showDebug ? "HIDE WEB DEBUGGER" : "WEB DEBUGGER"} small onPress={() => setShowDebug(!showDebug)} />
					{showDebug && <View style={styles.debug}>
						<Body size={12} color={ui.muted}>Optional sensor stream for a browser on your network.</Body>
						<View style={styles.roleRow}><TextInput style={styles.input} value={room} onChangeText={setRoom} editable={!debugOn} autoCapitalize="none" autoCorrect={false} placeholder="Room" placeholderTextColor={ui.muted} accessibilityLabel="Debugger room" /><SlantButton label={debugOn ? "STOP" : "STREAM"} small onPress={toggleDebug} /></View>
						<Body size={12} color={debug.state === "connected" ? ui.ready : ui.muted}>{debug.state === "connected" ? `Streaming · ${debug.viewers} viewers` : debug.error ?? (debugOn ? "Connecting…" : "Offline")}</Body>
					</View>}
				</Panel>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, padding: 12, gap: 10 },
	header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
	content: { flexGrow: 1, flexDirection: "row", gap: 12, paddingBottom: 6 },
	stack: { flexDirection: "column" },
	live: { flex: 1.15, justifyContent: "space-between", gap: 12 },
	guide: { flex: 1, gap: 10 },
	stackedPanel: { flex: 0, minHeight: 260 },
	roleRow: { flexDirection: "row", gap: 8, alignItems: "center" },
	grow: { flex: 1 },
	state: { fontFamily: fonts.display, fontSize: 38, color: ui.ink },
	direction: { flexDirection: "row", gap: 12, alignItems: "center" },
	arrow: { color: ui.blue, fontFamily: fonts.display, fontSize: 35, width: 40, textAlign: "center" },
	track: { height: 5, backgroundColor: ui.panel2, borderRadius: 3, overflow: "hidden" },
	trackFill: { height: "100%", backgroundColor: ui.ready },
	stats: { flexDirection: "row", gap: 6 },
	stat: { flex: 1, backgroundColor: ui.panel2, padding: 8, borderRadius: 4 },
	statValue: { color: ui.ink, fontFamily: fonts.display, fontSize: 25 },
	target: { height: 110, borderWidth: 1, borderColor: ui.line, borderRadius: 8, alignItems: "center", justifyContent: "center", overflow: "hidden" },
	crossH: { position: "absolute", left: "10%", right: "10%", height: 1, backgroundColor: ui.line },
	crossV: { position: "absolute", top: "10%", bottom: "10%", width: 1, backgroundColor: ui.line },
	dot: { height: 14, width: 14, borderRadius: 7, backgroundColor: ui.red },
	lastAction: { fontFamily: fonts.display, fontSize: 20, color: ui.gold, textAlign: "center" },
	guideRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	guideIcon: { color: ui.gold, fontFamily: fonts.display, fontSize: 24, width: 28, textAlign: "center" },
	debug: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderColor: ui.line },
	input: { flex: 1, minWidth: 0, color: ui.ink, borderColor: ui.line, borderWidth: 1, borderRadius: 4, padding: 8, fontFamily: fonts.body, fontSize: 14 },
});
