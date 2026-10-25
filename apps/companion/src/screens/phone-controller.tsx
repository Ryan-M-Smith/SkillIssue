import { useEffect, useRef, useState } from "react";
import {
	Platform,
	Pressable,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeviceMotion } from "expo-sensors";

import { MotionController, emptyControls } from "@/service/motion-control-service";
import { DebugLink, idleLinkStatus, type DebugLinkStatus } from "@/service/debug-link";
import { GameLink, idleGameStatus, type GameLinkStatus } from "@/service/game-link";
import { MotionTally, directionOf, zeroCounts, type Counts, type MovementState } from "@/lib/motion-summary";
import { defaultDebugRoom, defaultDebugServerUrl } from "@/lib/net/server-url";
import type { GameControls, Grip } from "@/types/motion";

const colors = {
	bg: "#0A1020",
	card: "#161F32",
	tile: "#1D2A40",
	border: "#2A3954",
	text: "#F1F6FF",
	muted: "#99AAC6",
	blue: "#57AAFF",
	green: "#39DBA2",
	yellow: "#FFC267",
	red: "#FF7891",
	teamBlue: "#57AAFF",
	teamRed: "#FF7891",
};

const stateColor: Record<MovementState, string> = {
	Calibrating: colors.yellow,
	Standing: colors.text,
	Walking: colors.blue,
	Sprinting: colors.green,
	Crouching: colors.yellow,
	"Crouch-walking": colors.yellow,
	Jumping: colors.green,
};

const countLabels: [keyof Counts, string][] = [
	["jumps", "Jumps"],
	["crouches", "Crouches"],
	["standUps", "Stand-ups"],
	["sprints", "Sprints"],
	["movements", "Moves"],
];

const redrawMs = 80;

function gameLine(status: GameLinkStatus): { text: string; tone: "muted" | "good" | "warn" | "bad" } {
	if (status.state === "idle") return { text: "Enter the code shown in the game.", tone: "muted" };
	if (status.state === "connecting") return { text: "Joining…", tone: "warn" };
	if (status.state === "closed") return { text: status.error ?? "Disconnected.", tone: "bad" };
	if (status.game === "playing") return { text: "Playing. Your moves go to the game.", tone: "good" };
	return { text: `In the lobby · ${status.players} phone${status.players === 1 ? "" : "s"} · waiting for the match to start`, tone: "warn" };
}

/** The movement phone, in landscape: what the model sees, plus links to the game and the debugger. */
export default function PhoneController() {
	const [controls, setControls] = useState<GameControls>(emptyControls);
	const [counts, setCounts] = useState<Counts>(zeroCounts);
	const [state, setState] = useState<MovementState>("Calibrating");
	const [grip, setGrip] = useState<Grip | null>(null);
	const [sensorError, setSensorError] = useState("");

	const [serverUrl, setServerUrl] = useState(defaultDebugServerUrl);
	const [code, setCode] = useState("");
	const [game, setGame] = useState<GameLinkStatus>(idleGameStatus);
	const [room, setRoom] = useState(defaultDebugRoom);
	const [debug, setDebug] = useState<DebugLinkStatus>(idleLinkStatus);
	const [debugOn, setDebugOn] = useState(false);

	const controllerRef = useRef(new MotionController("movement", Platform.OS));
	const tallyRef = useRef(new MotionTally());
	const gameRef = useRef<GameLink | null>(null);
	const debugRef = useRef<DebugLink | null>(null);
	const lastDrawRef = useRef(0);

	useEffect(() => {
		let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;
		let cancelled = false;

		(async () => {
			try {
				const permission = await DeviceMotion.requestPermissionsAsync();
				if (!permission.granted) throw new Error("Motion permission denied. Allow it in the phone's settings.");
				if (!(await DeviceMotion.isAvailableAsync())) throw new Error("This device has no motion sensors.");
				if (cancelled) return;

				DeviceMotion.setUpdateInterval(20);
				subscription = DeviceMotion.addListener((reading) => {
					const now = Date.now();
					const output = controllerRef.current.process(reading, now);
					tallyRef.current.add(output, now);
					gameRef.current?.update(output, reading);
					debugRef.current?.sendReading(reading);

					if (now - lastDrawRef.current >= redrawMs || output.action) {
						lastDrawRef.current = now;
						setControls(output);
						setCounts({ ...tallyRef.current.counts });
						setState(tallyRef.current.state(output, now));
						setGrip(output.ready ? controllerRef.current.getDebug().grip : null);
					}
				});
			} catch (e) {
				setSensorError(e instanceof Error ? e.message : String(e));
			}
		})();

		return () => {
			cancelled = true;
			subscription?.remove();
			gameRef.current?.leave();
			debugRef.current?.close();
		};
	}, []);

	function recalibrate() {
		controllerRef.current.reset();
		debugRef.current?.sendEvent("recalibrate");
	}

	function resetCounts() {
		tallyRef.current.reset();
		setCounts({ ...zeroCounts });
		debugRef.current?.sendEvent("reset_counts");
	}

	function toggleGame() {
		if (gameRef.current && game.state !== "closed") {
			gameRef.current.leave();
			gameRef.current = null;
			setGame(idleGameStatus);
			return;
		}
		gameRef.current?.leave();
		const link = new GameLink(serverUrl.trim(), Platform.OS, setGame);
		gameRef.current = link;
		link.join(code.trim());
	}

	function toggleDebug() {
		if (debugRef.current) {
			debugRef.current.close();
			debugRef.current = null;
			setDebugOn(false);
			setDebug(idleLinkStatus);
			return;
		}
		const link = new DebugLink(serverUrl.trim(), room.trim() || defaultDebugRoom, "phone", Platform.OS, {
			onStatus: setDebug,
			onEvent: (event) => {
				if (event === "recalibrate") controllerRef.current.reset();
				if (event === "reset_counts") {
					tallyRef.current.reset();
					setCounts({ ...zeroCounts });
				}
			},
		});
		debugRef.current = link;
		setDebugOn(true);
		link.open();
	}

	const direction = directionOf(controls);
	const inGame = game.state === "connecting" || game.state === "joined";
	const line = gameLine(game);
	const lineColor = { muted: colors.muted, good: colors.green, warn: colors.yellow, bad: colors.red }[line.tone];
	const teamColor = game.team === 2 ? colors.teamRed : colors.teamBlue;
	const debugText =
		debug.state === "connected"
			? `Streaming to ${debug.viewers} viewer${debug.viewers === 1 ? "" : "s"}`
			: debug.state === "idle"
				? "Off"
				: debug.error ?? "Connecting…";

	return (
		<SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
			<StatusBar hidden />
			<View style={styles.columns}>
				{/* LEFT: what you're doing */}
				<View style={[styles.card, styles.stateCol]}>
					<View style={styles.rowBetween}>
						<Text style={styles.overline}>MOVEMENT PHONE</Text>
						<Text style={[styles.badge, controls.ready && styles.badgeReady]}>
							{controls.ready ? `● ${grip ?? "ready"}` : "◌ hold still"}
						</Text>
					</View>
					<Text style={[styles.state, { color: stateColor[state] }]} numberOfLines={1} adjustsFontSizeToFit>
						{state}
					</Text>
					<View style={styles.row}>
						<Text style={styles.arrow}>{direction.arrow}</Text>
						<View style={{ flex: 1 }}>
							<Text style={styles.label}>DIRECTION</Text>
							<Text style={styles.direction} numberOfLines={1}>{direction.label}</Text>
						</View>
					</View>
					<View style={styles.row}>
						<Text style={[styles.flag, controls.crouch && styles.flagOn]}>CROUCH</Text>
						<Text style={[styles.flag, controls.sprint && styles.flagOn]}>SPRINT</Text>
					</View>
					{!!sensorError && <Text style={styles.error}>{sensorError}</Text>}
				</View>

				{/* MIDDLE: counts */}
				<View style={[styles.card, styles.countCol]}>
					<View style={styles.grid}>
						{countLabels.map(([key, label]) => (
							<View key={key} style={styles.tile}>
								<Text style={styles.tileValue}>{counts[key]}</Text>
								<Text style={styles.label}>{label.toUpperCase()}</Text>
							</View>
						))}
					</View>
					<View style={styles.row}>
						<Pressable style={styles.button} onPress={recalibrate}>
							<Text style={styles.buttonText}>RECALIBRATE</Text>
						</Pressable>
						<Pressable style={styles.button} onPress={resetCounts}>
							<Text style={styles.buttonText}>RESET</Text>
						</Pressable>
					</View>
				</View>

				{/* RIGHT: connections */}
				<ScrollView style={[styles.card, styles.linkCol]} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
					<Text style={styles.label}>SERVER</Text>
					<TextInput
						style={styles.input}
						value={serverUrl}
						onChangeText={setServerUrl}
						editable={!inGame && !debugOn}
						autoCapitalize="none"
						autoCorrect={false}
						placeholder="ws://192.168.1.20:8080"
						placeholderTextColor={colors.muted}
					/>

					<View style={styles.rowBetween}>
						<Text style={styles.label}>GAME</Text>
						{game.team != null && (
							<Text style={[styles.team, { color: teamColor, borderColor: teamColor }]}>TEAM {game.team}</Text>
						)}
					</View>
					<View style={styles.row}>
						<TextInput
							style={[styles.input, styles.grow]}
							value={code}
							onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
							editable={!inGame}
							keyboardType="number-pad"
							placeholder="Join code"
							placeholderTextColor={colors.muted}
						/>
						<Pressable
							style={[styles.button, styles.fit, inGame ? styles.stop : styles.go, !inGame && code.length !== 6 && styles.disabled]}
							onPress={toggleGame}
							disabled={!inGame && code.length !== 6}
						>
							<Text style={styles.buttonText}>{inGame ? "LEAVE" : "JOIN"}</Text>
						</Pressable>
					</View>
					<Text style={[styles.hint, { color: lineColor }]}>{line.text}</Text>

					<Text style={styles.label}>WEB DEBUGGER</Text>
					<View style={styles.row}>
						<TextInput
							style={[styles.input, styles.grow]}
							value={room}
							onChangeText={setRoom}
							editable={!debugOn}
							autoCapitalize="none"
							autoCorrect={false}
							placeholder="room"
							placeholderTextColor={colors.muted}
						/>
						<Pressable style={[styles.button, styles.fit, debugOn ? styles.stop : styles.go]} onPress={toggleDebug}>
							<Text style={styles.buttonText}>{debugOn ? "STOP" : "STREAM"}</Text>
						</Pressable>
					</View>
					<Text style={[styles.hint, debug.state === "connected" && { color: colors.green }]}>{debugText}</Text>
				</ScrollView>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.bg },
	columns: { flex: 1, flexDirection: "row", gap: 10, padding: 10 },
	card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 13, padding: 12, gap: 8 },
	stateCol: { flex: 1.15, justifyContent: "space-between" },
	countCol: { flex: 1, justifyContent: "space-between" },
	linkCol: { flex: 1.1 },
	row: { flexDirection: "row", alignItems: "center", gap: 8 },
	rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
	overline: { color: colors.blue, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
	badge: { color: colors.yellow, borderColor: colors.yellow, borderWidth: 1, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20, fontSize: 10, fontWeight: "800" },
	badgeReady: { color: colors.green, borderColor: colors.green },
	label: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
	state: { fontSize: 40, fontWeight: "900" },
	arrow: { color: colors.blue, fontSize: 40, fontWeight: "900", width: 46, textAlign: "center" },
	direction: { color: colors.text, fontSize: 20, fontWeight: "800" },
	flag: { flex: 1, color: colors.muted, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 5, fontSize: 11, fontWeight: "800", textAlign: "center", overflow: "hidden" },
	flagOn: { color: colors.bg, backgroundColor: colors.green, borderColor: colors.green },
	error: { color: colors.red, fontSize: 11 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	tile: { flexGrow: 1, flexBasis: "40%", backgroundColor: colors.tile, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
	tileValue: { color: colors.text, fontSize: 24, fontWeight: "900" },
	button: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#33415B", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
	fit: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
	grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
	go: { backgroundColor: "#287CC9" },
	stop: { backgroundColor: "#9F3555" },
	disabled: { opacity: 0.45 },
	buttonText: { color: "white", fontSize: 11, fontWeight: "900" },
	team: { borderWidth: 1, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8, fontSize: 10, fontWeight: "900" },
	hint: { color: colors.muted, fontSize: 11, lineHeight: 15 },
	input: { color: colors.text, backgroundColor: colors.tile, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14 },
});
