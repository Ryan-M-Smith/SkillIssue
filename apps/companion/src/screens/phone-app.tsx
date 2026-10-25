import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StatusBar, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeviceMotion } from "expo-sensors";

import { MotionController, emptyControls } from "@/service/motion-control-service";
import { LobbyClient, idleLobby, type ControllerRole, type LobbyView, type TeamId } from "@/service/lobby-client";
import { MotionTally, directionOf, zeroCounts, type Counts, type MovementState } from "@/lib/motion-summary";
import { defaultDebugServerUrl } from "@/lib/net/server-url";
import type { GameControls, Role } from "@/types/motion";

import { AimHud } from "./phone/aim-hud";
import { EnterCode } from "./phone/enter-code";
import { GameOver } from "./phone/game-over";
import { MainMenu } from "./phone/main-menu";
import { MovementHud } from "./phone/movement-hud";
import { Practice } from "./phone/practice";
import { TeamSelect } from "./phone/team-select";
import { ui } from "./phone/theme";

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
	const [weapon, setWeapon] = useState(0);
	const [firing, setFiring] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const clientRef = useRef<LobbyClient | null>(null);
	const roleRef = useRef<Role>("movement");
	const controllerRef = useRef(new MotionController("movement", Platform.OS));
	const tallyRef = useRef(new MotionTally());
	const lastDrawRef = useRef(0);

	// Motion sensors run the whole time; the model matches this phone's role.
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
				setNotice(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			cancelled = true;
			subscription?.remove();
			clientRef.current?.leave();
		};
	}, []);

	// Switch the motion model when the role changes; fresh counts at kick-off.
	const myRole = view.me?.role ?? null;
	useEffect(() => {
		const next = modelRole(myRole);
		if (next !== roleRef.current) {
			roleRef.current = next;
			controllerRef.current = new MotionController(next, Platform.OS);
		}
	}, [myRole]);

	useEffect(() => {
		if (view.stage === "playing") {
			tallyRef.current.reset();
			setCounts({ ...zeroCounts });
			setWeapon(0);
		}
		if (view.stage === "lobby") setWaitingAgain(false);
	}, [view.stage]);

	function join() {
		clientRef.current?.leave();
		const client = new LobbyClient(serverUrl.trim(), Platform.OS, setView);
		clientRef.current = client;
		client.join(code, name || "Player");
	}

	function leave() {
		clientRef.current?.leave();
		clientRef.current = null;
		setView(idleLobby);
		setWaitingAgain(false);
		setScreen("menu");
	}

	function fire(down: boolean) {
		setFiring(down);
		clientRef.current?.setFiring(down);
	}

	function pickWeapon(slot: number) {
		setWeapon(slot);
		clientRef.current?.selectWeapon(slot);
	}

	let body: ReactNode;
	if (screen === "menu") {
		body = (
			<MainMenu
				name={name}
				onName={setName}
				serverUrl={serverUrl}
				onServerUrl={setServerUrl}
				onJoin={() => setScreen("code")}
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
				onCode={setCode}
				onJoin={() => {
					setScreen("match");
					join();
				}}
				onBack={leave}
				busy={screen === "match" && view.stage === "connecting"}
				error={screen === "match" ? view.error : null}
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
				<AimHud view={view} controls={controls} weapon={weapon} firing={firing} onFire={fire} onScope={() => clientRef.current?.toggleScope()} onWeapon={pickWeapon} />
			) : (
				<MovementHud view={view} controls={controls} state={state} direction={directionOf(controls)} counts={counts} />
			);
	} else {
		body = <GameOver view={view} waiting={waitingAgain} onPlayAgain={() => setWaitingAgain(true)} onMenu={leave} />;
	}

	return (
		<SafeAreaView style={styles.root} edges={["top", "bottom", "left", "right"]}>
			<StatusBar hidden />
			{body}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, backgroundColor: ui.bg },
});
