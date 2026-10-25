import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StatusBar, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MotionSensor as DeviceMotion } from "@/service/motion-sensor";
import * as Linking from "expo-linking";

import { MotionController, emptyControls } from "@/service/motion-control-service";
import { LobbyClient, idleLobby, type ControllerRole, type LobbyView, type TeamId } from "@/service/lobby-client";
import { MotionTally, directionOf, zeroCounts, type Counts, type MovementState } from "@/lib/motion-summary";
import { defaultDebugServerUrl } from "@/lib/net/server-url";
import { normalizeLobbyCode } from "@/lib/net/lobby-code";
import { publicGameServer } from "@/lib/net/relay";
import { useMotionAccess } from "@/lib/motion-permission";
import type { GameControls, Role } from "@/types/motion";

import { AimHud } from "./phone/aim-hud";
import { EnterCode } from "./phone/enter-code";
import { GameOver } from "./phone/game-over";
import { MainMenu } from "./phone/main-menu";
import { MotionAccessPrompt } from "./phone/motion-access";
import { MovementHud } from "./phone/movement-hud";
import { Practice } from "./phone/practice";
import { TeamSelect } from "./phone/team-select";
import { ui } from "./phone/theme";
import { Body } from "./phone/kit";

type Screen = "menu" | "code" | "practice" | "match";

const redrawMs = 80;

const modelRole = (role: ControllerRole | null | undefined): Role => (role === "aim" ? "gunner" : "movement");

/**
 * The phone app, following the flow on the whiteboard:
 * Main Menu → Join a Lobby → Enter Code → Team + Role Select (Ready) → Load into Game
 * → Game Over → Main Menu / Play Again.
 */
export default function PhoneApp() {
	const [screen, setScreen] = useState<Screen>("menu");
	const [name, setName] = useState("");
	const [serverUrl, setServerUrl] = useState(defaultDebugServerUrl);
	const [code, setCode] = useState("");
	const [view, setView] = useState<LobbyView>(idleLobby);
	const [waitingAgain, setWaitingAgain] = useState(false);

	const [controls, setControls] = useState<GameControls>(emptyControls);
	const [counts, setCounts] = useState<Counts>(zeroCounts);
	const [state, setState] = useState<MovementState>("Calibrating");
	const [notice, setNotice] = useState<string | null>(null);
	const [joinError, setJoinError] = useState<string | null>(null);
	const [firing, setFiring] = useState(false);
	const [sensorSession, setSensorSession] = useState(0);
	const activeControls = screen === "match" && (view.stage === "lobby" || view.stage === "playing");
	const { access: motionAccess, request: requestMotion } = useMotionAccess(activeControls);
	const sensorsAllowed = motionAccess === "granted";

	const clientRef = useRef<LobbyClient | null>(null);
	const joinAttemptRef = useRef(0);
	const roleRef = useRef<Role>("movement");
	const controllerRef = useRef(new MotionController("movement", Platform.OS));
	const tallyRef = useRef(new MotionTally());
	const lastDrawRef = useRef(0);
	const stageRef = useRef(view.stage);
	const gameStateRef = useRef(view.state);

	useEffect(() => {
		let cancelled = false;
		function handleLink(link: string | null) {
			if (cancelled || !link) return;
			try {
				const url = new URL(link);
				if (!url.searchParams.has("code")) return;
				const linkCode = normalizeLobbyCode(url.searchParams.get("code") ?? "");
				clientRef.current?.leave();
				clientRef.current = null;
				setCode(linkCode);
				setScreen("code");
				setJoinError(null);
			} catch (e) {
				setJoinError(e instanceof Error ? e.message : "This lobby link is invalid.");
				setScreen("code");
			}
		}
		void Linking.getInitialURL().then(handleLink).catch(() => {});
		const subscription = Linking.addEventListener("url", ({ url }) => handleLink(url));
		return () => { cancelled = true; subscription.remove(); };
	}, []);

	// Practice owns its own sensors; the match model runs only while in a lobby/game.
	useEffect(() => {
		// Access is asked for explicitly (MotionAccessPrompt); sensors start once it's granted.
		if (!activeControls || !sensorsAllowed) return;
		let subscription: ReturnType<typeof DeviceMotion.addListener> | null = null;
		let cancelled = false;
		(async () => {
			try {
				if (cancelled) return;
				// ~60 Hz: the controller sends each processed sample right away.
				DeviceMotion.setUpdateInterval(16);
				subscription = DeviceMotion.addListener((reading) => {
					const now = Date.now();
					const output = controllerRef.current.process(reading, now);
					if (roleRef.current === "movement") tallyRef.current.add(output, now);
					clientRef.current?.update(output, reading);
					if (now - lastDrawRef.current >= redrawMs || output.action) {
						lastDrawRef.current = now;
						setControls(output);
						setCounts({ ...tallyRef.current.counts });
						setState(tallyRef.current.state(output, now));
					}
				});
			} catch (e) {
				if (!cancelled) setNotice(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			cancelled = true;
			subscription?.remove();
		};
	}, [activeControls, sensorsAllowed, sensorSession]);

	useEffect(() => () => { clientRef.current?.leave(); }, []);

	function recenter() {
		controllerRef.current.reset();
		// Browser motion permission must be requested directly from a user gesture.
		void requestMotion().then((next) => {
			if (next === "granted") { setNotice(null); setSensorSession((session) => session + 1); }
		});
	}

	// Synchronize the sensor model before the next reading reaches the game.
	function onLobbyChange(next: LobbyView) {
		if (next.stage === "idle" && stageRef.current === "ended") setScreen("menu");
		if (next.stage !== "playing" || next.state === "paused") setFiring(false);
		const role = modelRole(next.me?.role);
		if (role !== roleRef.current) {
			roleRef.current = role;
			controllerRef.current = new MotionController(role, Platform.OS);
		}
		if (next.stage === "playing" && (stageRef.current !== "playing" || (gameStateRef.current === "paused" && next.state === "playing"))) {
			tallyRef.current.reset();
			setCounts({ ...zeroCounts });
			controllerRef.current.reset();
			setControls(emptyControls);
			setState("Calibrating");
		}
		if (next.stage === "lobby") setWaitingAgain(false);
		stageRef.current = next.stage;
		gameStateRef.current = next.state;
		setView(next);
	}

	/** Every lobby lives on the Skill Issue relay: find it, then join with the code. */
	async function join() {
		const attempt = ++joinAttemptRef.current;
		clientRef.current?.leave();
		clientRef.current = null;
		let lobbyCode: string;
		try {
			lobbyCode = normalizeLobbyCode(code);
		} catch (e) {
			setJoinError((e as Error).message);
			return;
		}
		setJoinError(null);
		recenter();
		setScreen("match");
		onLobbyChange({ ...idleLobby, stage: "connecting", code: lobbyCode });
		const relay = await publicGameServer();
		if (attempt !== joinAttemptRef.current) return; // cancelled or replaced
		if (!relay) {
			onLobbyChange(idleLobby);
			setScreen("code");
			setJoinError("Can't reach the Skill Issue servers. Check your internet connection and try again.");
			return;
		}
		const client = new LobbyClient(relay, Platform.OS, onLobbyChange);
		clientRef.current = client;
		client.join(lobbyCode, name || "Player");
	}

	function leave() {
		joinAttemptRef.current += 1;
		clientRef.current?.leave();
		clientRef.current = null;
		setView(idleLobby);
		setWaitingAgain(false);
		setJoinError(null);
		setScreen("menu");
	}

	let body: ReactNode;
	if (screen === "menu") {
		body = (
			<MainMenu
				name={name}
				onName={setName}
				serverUrl={serverUrl}
				onServerUrl={setServerUrl}
				onJoin={() => { setJoinError(null); setScreen("code"); }}
				onPractice={() => setScreen("practice")}
				notice={notice}
			/>
		);
	} else if (screen === "practice") {
		body = <Practice serverUrl={serverUrl} onBack={() => setScreen("menu")} />;
	} else if (screen === "code" || view.stage === "idle" || view.stage === "connecting" || view.stage === "closed") {
		body = (
			<EnterCode
				code={code}
				onCode={(value) => { setCode(value); setJoinError(null); }}
				onJoin={() => void join()}
				onBack={leave}
				busy={screen === "match" && view.stage === "connecting"}
				error={joinError ?? (screen === "match" ? view.error : null)}
			/>
		);
	} else if (view.stage === "lobby") {
		body = (
			<TeamSelect
				view={view}
				onPick={(team: TeamId, role: ControllerRole) => clientRef.current?.selectSlot(team, role)}
				onReady={(ready) => clientRef.current?.setReady(ready)}
				onLeave={leave}
			/>
		);
	} else if (view.stage === "playing") {
		body =
			view.me?.role === "aim" ? (
				<AimHud
					view={view}
					controls={controls}
					weapon={view.feedback?.weapon ?? 0}
					firing={firing}
					onFire={(down) => { setFiring(down); clientRef.current?.setFiring(down); }}
					onAim={() => clientRef.current?.toggleAim()}
					onReload={() => clientRef.current?.reload()}
					onSwitch={() => clientRef.current?.nextWeapon()}
					onRecalibrate={recenter}
				/>
			) : (
				<MovementHud view={view} controls={controls} state={state} direction={directionOf(controls)} counts={counts} onRecalibrate={recenter} />
			);
	} else {
		body = <GameOver view={view} waiting={waitingAgain} onPlayAgain={() => setWaitingAgain(true)} onMenu={leave} />;
	}

	return (
		<SafeAreaView style={styles.root} edges={["top", "bottom", "left", "right"]}>
			<StatusBar hidden />
			{body}
			{notice && screen === "match" && view.stage === "playing" && <Body size={12} color={ui.gold} style={styles.notice}>{notice} Tap RECENTER to retry.</Body>}
			{activeControls && motionAccess !== "granted" && motionAccess !== "checking" && (
				<MotionAccessPrompt access={motionAccess} onAllow={() => void requestMotion()} onBack={leave} backLabel="LEAVE" />
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, backgroundColor: ui.bg },
	notice: { position: "absolute", bottom: 6, left: 20, right: 20, textAlign: "center", backgroundColor: ui.bg },
});
