import { useEffect, useRef, useState } from "react";
import {
	Platform,
	Pressable,
	SafeAreaView,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { DeviceMotion } from "expo-sensors";

import { MotionController, emptyControls } from "@/service/motion-control-service";
import { DebugLink, idleLinkStatus, type DebugLinkStatus } from "@/service/debug-link";
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
	["movements", "Movements"],
];

const redrawMs = 80;

/** The movement phone: runs the motion model, shows a summary, streams to the web debugger. */
export default function PhoneController() {
	const [controls, setControls] = useState<GameControls>(emptyControls);
	const [counts, setCounts] = useState<Counts>(zeroCounts);
	const [state, setState] = useState<MovementState>("Calibrating");
	const [grip, setGrip] = useState<Grip | null>(null);
	const [sensorError, setSensorError] = useState("");

	const [serverUrl, setServerUrl] = useState(defaultDebugServerUrl);
	const [room, setRoom] = useState(defaultDebugRoom);
	const [link, setLink] = useState<DebugLinkStatus>(idleLinkStatus);
	const [linkOn, setLinkOn] = useState(false);

	const controllerRef = useRef(new MotionController("movement", Platform.OS));
	const tallyRef = useRef(new MotionTally());
	const linkRef = useRef<DebugLink | null>(null);
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
					linkRef.current?.sendReading(reading);

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
			linkRef.current?.close();
		};
	}, []);

	function recalibrate() {
		controllerRef.current.reset();
		linkRef.current?.sendEvent("recalibrate");
	}

	function resetCounts() {
		tallyRef.current.reset();
		setCounts({ ...zeroCounts });
		linkRef.current?.sendEvent("reset_counts");
	}

	function toggleLink() {
		if (linkRef.current) {
			linkRef.current.close();
			linkRef.current = null;
			setLinkOn(false);
			setLink(idleLinkStatus);
			return;
		}
		const next = new DebugLink(serverUrl.trim(), room.trim() || defaultDebugRoom, "phone", Platform.OS, {
			onStatus: setLink,
			onEvent: (event) => {
				if (event === "recalibrate") controllerRef.current.reset();
				if (event === "reset_counts") {
					tallyRef.current.reset();
					setCounts({ ...zeroCounts });
				}
			},
		});
		linkRef.current = next;
		setLinkOn(true);
		next.open();
	}

	const direction = directionOf(controls);
	const linkText =
		link.state === "connected"
			? `Streaming to ${link.viewers} viewer${link.viewers === 1 ? "" : "s"} in room "${room}"`
			: link.state === "idle"
				? "Not connected"
				: link.error ?? "Connecting…";

	return (
		<SafeAreaView style={styles.screen}>
			<StatusBar barStyle="light-content" />
			<ScrollView contentContainerStyle={styles.content}>
				<View style={styles.header}>
					<View>
						<Text style={styles.overline}>SKILLISSUE · MOVEMENT PHONE</Text>
						<Text style={styles.title}>Controller</Text>
					</View>
					<Text style={[styles.badge, controls.ready && styles.badgeReady]}>
						{controls.ready ? `● ${grip ?? "ready"}` : "◌ hold still"}
					</Text>
				</View>

				{!!sensorError && <Text style={styles.error}>{sensorError}</Text>}

				<View style={styles.card}>
					<Text style={styles.label}>CURRENT STATE</Text>
					<Text style={[styles.state, { color: stateColor[state] }]}>{state}</Text>
					<View style={styles.row}>
						<Text style={styles.arrow}>{direction.arrow}</Text>
						<View style={{ flex: 1 }}>
							<Text style={styles.label}>DIRECTION</Text>
							<Text style={styles.direction}>{direction.label}</Text>
						</View>
						<View style={styles.flags}>
							<Text style={[styles.flag, controls.crouch && styles.flagOn]}>CROUCH</Text>
							<Text style={[styles.flag, controls.sprint && styles.flagOn]}>SPRINT</Text>
						</View>
					</View>
				</View>

				<View style={styles.grid}>
					{countLabels.map(([key, label]) => (
						<View key={key} style={styles.tile}>
							<Text style={styles.tileValue}>{counts[key]}</Text>
							<Text style={styles.label}>{label.toUpperCase()}</Text>
						</View>
					))}
				</View>

				<View style={styles.buttons}>
					<Pressable style={styles.button} onPress={recalibrate}>
						<Text style={styles.buttonText}>RECALIBRATE</Text>
					</Pressable>
					<Pressable style={styles.button} onPress={resetCounts}>
						<Text style={styles.buttonText}>RESET COUNTS</Text>
					</Pressable>
				</View>

				<View style={styles.card}>
					<Text style={styles.label}>WEB DEBUGGER</Text>
					<Text style={styles.hint}>
						Run the server on your computer, open the companion's web version there, and connect this phone to the same room.
					</Text>
					<TextInput
						style={styles.input}
						value={serverUrl}
						onChangeText={setServerUrl}
						editable={!linkOn}
						autoCapitalize="none"
						autoCorrect={false}
						placeholder="ws://192.168.1.20:8080"
						placeholderTextColor={colors.muted}
					/>
					<TextInput
						style={styles.input}
						value={room}
						onChangeText={setRoom}
						editable={!linkOn}
						autoCapitalize="none"
						autoCorrect={false}
						placeholder="room"
						placeholderTextColor={colors.muted}
					/>
					<Pressable style={[styles.button, linkOn ? styles.stop : styles.go]} onPress={toggleLink}>
						<Text style={styles.buttonText}>{linkOn ? "DISCONNECT" : "CONNECT"}</Text>
					</Pressable>
					<Text style={[styles.hint, link.state === "connected" && { color: colors.green }]}>{linkText}</Text>
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.bg },
	content: { padding: 18, paddingBottom: 48, gap: 14 },
	header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
	overline: { color: colors.blue, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
	title: { color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 3 },
	badge: { color: colors.yellow, borderColor: colors.yellow, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, fontSize: 11, fontWeight: "800" },
	badgeReady: { color: colors.green, borderColor: colors.green },
	error: { color: colors.red, backgroundColor: "#442431", borderRadius: 8, padding: 10 },
	card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 13, padding: 15, gap: 10 },
	label: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
	state: { fontSize: 40, fontWeight: "900" },
	row: { flexDirection: "row", alignItems: "center", gap: 14 },
	arrow: { color: colors.blue, fontSize: 44, fontWeight: "900", width: 52, textAlign: "center" },
	direction: { color: colors.text, fontSize: 20, fontWeight: "800" },
	flags: { gap: 6 },
	flag: { color: colors.muted, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 8, fontSize: 10, fontWeight: "800", textAlign: "center" },
	flagOn: { color: colors.bg, backgroundColor: colors.green, borderColor: colors.green },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	tile: { flexGrow: 1, flexBasis: "30%", backgroundColor: colors.tile, borderRadius: 10, padding: 12, gap: 4 },
	tileValue: { color: colors.text, fontSize: 26, fontWeight: "900" },
	buttons: { flexDirection: "row", gap: 10 },
	button: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#33415B", padding: 13, borderRadius: 10 },
	go: { backgroundColor: "#287CC9", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
	stop: { backgroundColor: "#9F3555", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
	buttonText: { color: "white", fontSize: 11, fontWeight: "900" },
	hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
	input: { color: colors.text, backgroundColor: colors.tile, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14 },
});
