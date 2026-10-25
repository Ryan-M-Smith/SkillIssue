import { useEffect, useRef, useState } from "react";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
	useWindowDimensions,
} from "react-native";

import Phone3D, { type Phone3DPose } from "@/components/phone-3d";
import { Axis, Panel, Value } from "@/components/motion-ui";
import { MotionController, emptyControls } from "@/service/motion-control-service";
import { DebugLink, idleLinkStatus, type DebugLinkStatus } from "@/service/debug-link";
import { displayRotation } from "@/lib/math/orientation";
import { deviceRotationRate, dot } from "@/lib/math/motion";
import { MotionTally, directionOf, zeroCounts, type Counts, type MovementState } from "@/lib/motion-summary";
import { defaultDebugRoom, defaultDebugServerUrl } from "@/lib/net/server-url";
import type { Action, GameControls, MotionDebug, MotionReading, MotionVector } from "@/types/motion";

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

const actionText: Record<Exclude<Action, null>, string> = {
	jump: "JUMP",
	crouch: "CROUCH",
	stand: "STAND UP",
	sprint: "SPRINT",
	shoot: "SHOOT",
};

const zeroDebug: MotionDebug = {
	calibration: "calibrating",
	grip: "portrait",
	pitchDeg: 0,
	sidePressDeg: 0,
	pitchRate: 0,
	sidePressRate: 0,
	twistRate: 0,
	burst: "none",
	sprintPhase: "off",
	gesture: "armed",
};

type Snapshot = {
	controls: GameControls;
	debug: MotionDebug;
	counts: Counts;
	state: MovementState;
	gyro: MotionVector;
	accel: MotionVector;
	gravity: MotionVector;
	rateHz: number;
	platform: string;
};

const emptySnapshot: Snapshot = {
	controls: emptyControls,
	debug: zeroDebug,
	counts: zeroCounts,
	state: "Calibrating",
	gyro: { x: 0, y: 0, z: 0 },
	accel: { x: 0, y: 0, z: 0 },
	gravity: { x: 0, y: 0, z: 0 },
	rateHz: 0,
	platform: "—",
};

const redrawMs = 80;
const yawLeakSeconds = 1.5;
const keepReadings = 500; // 10 s at 50 Hz

const fmt = (n: number, places = 1) => (Number.isFinite(n) ? n.toFixed(places) : "0");
const fmtVec = (v: MotionVector, places = 1) => `${fmt(v.x, places)}  ${fmt(v.y, places)}  ${fmt(v.z, places)}`;

/** Web: shows what the connected phone's motion model sees, with a live 3D view. */
export default function DebugDashboard() {
	const { width } = useWindowDimensions();
	// The web build is server-rendered without a window; pick the wide layout
	// only after hydrating so the first client render matches the server's.
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);
	const wide = hydrated && width >= 980;

	// Filled in after mount: the server render has no window to read it from.
	const [serverUrl, setServerUrl] = useState("");
	const [room, setRoom] = useState(defaultDebugRoom);
	const [link, setLink] = useState<DebugLinkStatus>(idleLinkStatus);
	const [linkOn, setLinkOn] = useState(false);
	const [snap, setSnap] = useState<Snapshot>(emptySnapshot);
	const [history, setHistory] = useState<string[]>([]);
	const [note, setNote] = useState("");

	const linkRef = useRef<DebugLink | null>(null);
	const controllerRef = useRef<MotionController | null>(null);
	const platformRef = useRef("");
	const tallyRef = useRef(new MotionTally());
	const poseRef = useRef<Phone3DPose>({ rotation: null });
	const yawRef = useRef(0);
	const lastStampRef = useRef<number | null>(null);
	const lastDrawRef = useRef(0);
	const latestRef = useRef<Snapshot>(emptySnapshot);
	const readingsRef = useRef<MotionReading[]>([]);
	const rateRef = useRef({ since: 0, count: 0, hz: 0 });

	function resetView() {
		controllerRef.current?.reset();
		poseRef.current = { rotation: null };
		yawRef.current = 0;
	}

	function resetCounts() {
		tallyRef.current.reset();
		setHistory([]);
	}

	function handleReadings(platform: string, readings: MotionReading[]) {
		if (!controllerRef.current || platformRef.current !== platform) {
			controllerRef.current = new MotionController("movement", platform);
			platformRef.current = platform;
			yawRef.current = 0;
		}
		const controller = controllerRef.current;
		const now = Date.now();
		const events: string[] = [];

		for (const reading of readings) {
			const output = controller.process(reading, now);
			tallyRef.current.add(output, now);
			readingsRef.current.push(reading);
			if (readingsRef.current.length > keepReadings) readingsRef.current.shift();

			const gyro = reading.rotationRate ? deviceRotationRate(reading.rotationRate, platform) : { x: 0, y: 0, z: 0 };
			const orientation = controller.getOrientation();
			const stamp = reading.rotationRate?.timestamp ?? reading.rotation.timestamp;
			const dt = stamp != null && lastStampRef.current != null ? Math.min(0.1, Math.max(0, stamp - lastStampRef.current)) : 0.02;
			lastStampRef.current = stamp ?? null;

			if (orientation) {
				// Turning about the vertical doesn't move gravity, so integrate it
				// from the gyro for display only, easing back to facing forward.
				const g = orientation.gravity;
				const yawRate = -dot(gyro, g);
				yawRef.current = (yawRef.current + yawRate * dt) * Math.exp(-dt / yawLeakSeconds);
				poseRef.current = { rotation: displayRotation(orientation.frame, g, yawRef.current) };
			} else {
				poseRef.current = { rotation: null };
			}

			if (output.action) {
				const detail =
					output.action === "crouch" ? (output.crouch ? " on" : " off")
					: output.action === "sprint" ? (output.sprint ? " on" : " off")
					: "";
				events.push(`${new Date(now).toLocaleTimeString()} • ${actionText[output.action]}${detail}`);
			}

			latestRef.current = {
				controls: output,
				debug: controller.getDebug(),
				counts: { ...tallyRef.current.counts },
				state: tallyRef.current.state(output, now),
				gyro,
				accel: reading.acceleration ?? { x: 0, y: 0, z: 0 },
				gravity: orientation?.gravity ?? { x: 0, y: 0, z: 0 },
				rateHz: rateRef.current.hz,
				platform,
			};
		}

		const rate = rateRef.current;
		if (!rate.since) rate.since = now;
		rate.count += readings.length;
		if (now - rate.since >= 1000) {
			rate.hz = Math.round((rate.count * 1000) / (now - rate.since));
			rate.since = now;
			rate.count = 0;
		}

		if (events.length) setHistory((prev) => [...events.reverse(), ...prev].slice(0, 8));
		if (now - lastDrawRef.current >= redrawMs || events.length) {
			lastDrawRef.current = now;
			setSnap({ ...latestRef.current, rateHz: rate.hz });
		}
	}

	function toggleLink(url = serverUrl) {
		if (linkRef.current) {
			linkRef.current.close();
			linkRef.current = null;
			setLinkOn(false);
			setLink(idleLinkStatus);
			return;
		}
		const next = new DebugLink(url.trim(), room.trim() || defaultDebugRoom, "viewer", "web", {
			onStatus: setLink,
			onMotion: (message) => handleReadings(message.platform, message.readings as MotionReading[]),
			onEvent: (event) => {
				if (event === "recalibrate") resetView();
				if (event === "reset_counts") resetCounts();
			},
		});
		linkRef.current = next;
		setLinkOn(true);
		next.open();
	}

	async function copyRecording() {
		const text = JSON.stringify({ platform: platformRef.current || "ios", samples: readingsRef.current });
		try {
			await navigator.clipboard.writeText(text);
			setNote(`Copied ${readingsRef.current.length} readings. Paste them into the Motion Bench replay.`);
		} catch {
			setNote("The browser blocked the clipboard. Allow clipboard access and try again.");
		}
	}

	// Connect on open; close on leave.
	useEffect(() => {
		const url = defaultDebugServerUrl();
		setServerUrl(url);
		toggleLink(url);
		return () => linkRef.current?.close();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const { controls, debug, counts } = snap;
	const direction = directionOf(controls);
	const phoneOnline = link.state === "connected" && link.phones > 0;
	const statusText =
		link.state === "idle" ? "Not connected"
		: link.state !== "connected" ? link.error ?? "Connecting…"
		: phoneOnline ? `Phone streaming · ${snap.platform} · ${snap.rateHz} Hz`
		: `Waiting for a phone in room "${room}"`;

	return (
		<ScrollView style={styles.screen} contentContainerStyle={styles.content}>
			<View style={styles.header}>
				<View style={{ flexShrink: 1 }}>
					<Text style={styles.overline}>SKILLISSUE · WEB DEBUGGER</Text>
					<Text style={styles.title}>Motion Debugger</Text>
					<Text style={styles.hint}>What the phone's motion model sees, live. Same code as the phone, fed with the phone's own sensor stream.</Text>
				</View>
				<View style={styles.connect}>
					<TextInput style={[styles.input, { minWidth: 220 }]} value={serverUrl} onChangeText={setServerUrl} editable={!linkOn} autoCapitalize="none" autoCorrect={false} aria-label="Server address" />
					<TextInput style={[styles.input, { width: 110 }]} value={room} onChangeText={setRoom} editable={!linkOn} autoCapitalize="none" autoCorrect={false} aria-label="Room" />
					<Pressable style={[styles.button, linkOn ? styles.stop : styles.go]} onPress={() => toggleLink()}>
						<Text style={styles.buttonText}>{linkOn ? "DISCONNECT" : "CONNECT"}</Text>
					</Pressable>
				</View>
			</View>

			<View style={[styles.statusBar, phoneOnline && styles.statusOk]}>
				<Text style={[styles.statusText, phoneOnline && { color: colors.green }]}>{statusText}</Text>
				{link.state === "connected" && !phoneOnline && link.addresses.length > 0 && (
					<Text style={styles.hint}>
						On the phone, connect to {link.addresses.join(" or ")} with room "{room}".
					</Text>
				)}
			</View>

			<View style={[styles.columns, wide && styles.columnsWide]}>
				<View style={[styles.col, wide && { flex: 1.1 }]}>
					<Panel title="PHONE IN 3D">
						<Phone3D getPose={() => poseRef.current} height={wide ? 460 : 340} />
						<View style={styles.stats}>
							<Value name="GRIP" value={controls.ready ? debug.grip.toUpperCase() : "—"} active={controls.ready} />
							<Value name="CALIBRATION" value={controls.ready ? "READY" : "HOLD STILL"} active={controls.ready} />
							<Value name="FAST MOTION" value={debug.burst.toUpperCase()} />
						</View>
						<Text style={styles.hint}>
							You're behind the phone. Blue is the pitch axis (forward and back, jump, crouch), orange the side axis (strafe), green the screen's Z axis (twist for sprint). Turning about the vertical is drawn from the gyro and eases back to centre.
						</Text>
						<View style={styles.buttons}>
							<Pressable style={styles.button} onPress={resetView}><Text style={styles.buttonText}>RECALIBRATE VIEW</Text></Pressable>
							<Pressable style={styles.button} onPress={copyRecording}><Text style={styles.buttonText}>COPY LAST 10 S</Text></Pressable>
						</View>
						{!!note && <Text style={styles.hint}>{note}</Text>}
					</Panel>
				</View>

				<View style={[styles.col, wide && { flex: 1 }]}>
					<Panel title="SUMMARY">
						<View style={styles.row}>
							<Text style={styles.arrow}>{direction.arrow}</Text>
							<View style={{ flex: 1 }}>
								<Text style={styles.state}>{snap.state}</Text>
								<Text style={styles.hint}>Direction: {direction.label}</Text>
							</View>
						</View>
						<View style={styles.stats}>
							<Value name="JUMPS" value={counts.jumps} />
							<Value name="CROUCHES" value={counts.crouches} />
							<Value name="STAND-UPS" value={counts.standUps} />
							<Value name="SPRINTS" value={counts.sprints} />
							<Value name="MOVEMENTS" value={counts.movements} />
						</View>
						<Pressable style={[styles.button, { flexGrow: 0, flexBasis: "auto" }]} onPress={() => { resetCounts(); linkRef.current?.sendEvent("reset_counts"); }}>
							<Text style={styles.buttonText}>RESET COUNTS</Text>
						</Pressable>
					</Panel>

					<Panel title="MOVEMENT OUTPUT">
						<Axis name="FORWARD / BACK" value={controls.moveY} negative="back" positive="forward" />
						<Axis name="STRAFE" value={controls.moveX} negative="left" positive="right" />
						<View style={styles.stats}>
							<Value name="SPRINT" value={controls.sprint ? "ON" : "OFF"} active={controls.sprint} />
							<Value name="CROUCH" value={controls.crouch ? "ON" : "OFF"} active={controls.crouch} />
						</View>
					</Panel>

					<Panel title="GESTURES DETECTED">
						{history.length === 0 ? (
							<Text style={styles.hint}>Flick, twist or tilt the phone to see gestures here.</Text>
						) : (
							history.map((line, i) => (
								<Text key={`${line}-${i}`} style={[styles.event, i > 0 && { color: colors.muted }]}>{line}</Text>
							))
						)}
					</Panel>

					<Panel title="GESTURE DIAGNOSTICS">
						<View style={styles.stats}>
							<Value name="FORWARD TILT" value={`${fmt(debug.pitchDeg)}°`} />
							<Value name="RIGHT TILT" value={`${fmt(debug.sidePressDeg)}°`} />
						</View>
						<View style={styles.stats}>
							<Value name="PITCH RATE" value={`${fmt(debug.pitchRate, 0)} °/s`} />
							<Value name="SIDE RATE" value={`${fmt(debug.sidePressRate, 0)} °/s`} />
							<Value name="TWIST (Z) RATE" value={`${fmt(debug.twistRate, 0)} °/s`} />
						</View>
						<View style={styles.stats}>
							<Value name="GESTURES" value={debug.gesture.toUpperCase()} active={debug.gesture === "armed"} />
							<Value name="SPRINT" value={debug.sprintPhase.toUpperCase()} active={debug.sprintPhase === "on"} />
						</View>
					</Panel>

					<Panel title="RAW SENSOR VALUES">
						<Text style={styles.raw}>GYRO °/s  X Y Z:  {fmtVec(snap.gyro)}</Text>
						<Text style={styles.raw}>LINEAR ACCEL m/s²:  {fmtVec(snap.accel)}</Text>
						<Text style={styles.raw}>GRAVITY (unit):  {fmtVec(snap.gravity, 2)}</Text>
						<Text style={styles.hint}>Gyro is mapped to the phone's own X / Y / Z axes for {snap.platform}.</Text>
					</Panel>
				</View>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.bg },
	content: { padding: 20, paddingBottom: 48, gap: 14, maxWidth: 1400, width: "100%", alignSelf: "center" },
	header: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 14 },
	overline: { color: colors.blue, fontSize: 10, letterSpacing: 2, fontWeight: "800" },
	title: { color: colors.text, fontSize: 30, fontWeight: "900", marginTop: 3 },
	connect: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
	input: { color: colors.text, backgroundColor: colors.tile, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12, fontSize: 14 },
	statusBar: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, gap: 4, backgroundColor: colors.card },
	statusOk: { borderColor: colors.green },
	statusText: { color: colors.yellow, fontWeight: "800", fontSize: 13 },
	columns: { gap: 14 },
	columnsWide: { flexDirection: "row", alignItems: "flex-start" },
	col: { gap: 14, minWidth: 0 },
	stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	row: { flexDirection: "row", alignItems: "center", gap: 14 },
	arrow: { color: colors.blue, fontSize: 44, fontWeight: "900", width: 52, textAlign: "center" },
	state: { color: colors.text, fontSize: 30, fontWeight: "900" },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	button: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#33415B", paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10 },
	go: { backgroundColor: "#287CC9", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
	stop: { backgroundColor: "#9F3555", flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
	buttonText: { color: "white", fontSize: 11, fontWeight: "900" },
	hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
	event: { color: colors.green, fontSize: 13, fontWeight: "700" },
	raw: { color: colors.blue, fontSize: 12, fontFamily: "monospace" },
});
