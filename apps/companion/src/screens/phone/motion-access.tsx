import { Linking, Platform, StyleSheet, View } from "react-native";

import type { MotionAccess } from "@/lib/motion-permission";
import { Body, Eyebrow, Panel, Script, SlantButton, Title } from "./kit";
import { ui } from "./theme";

/**
 * Shown over a screen that needs the motion sensors until access is granted:
 * asks for it, or explains how to turn it back on in Settings.
 */
export function MotionAccessPrompt({ access, onAllow, onBack, backLabel = "BACK" }: {
	access: MotionAccess;
	onAllow: () => void;
	onBack?: () => void;
	backLabel?: string;
}) {
	const blocked = access === "blocked";
	const unavailable = access === "unavailable";
	const web = Platform.OS === "web";
	return (
		<View style={styles.shade} accessibilityViewIsModal>
			<Panel style={styles.card} fill={ui.panel}>
				<Script size={18}>one more thing…</Script>
				<Title size={28} depth={0.1}>{unavailable ? "NO MOTION SENSORS" : "MOTION ACCESS NEEDED"}</Title>
				<Body size={15} color={ui.soft}>
					{unavailable
						? web
							? "This browser can't read the phone's motion. Open the Skill Issue app, or use an HTTPS page on a phone."
							: "This device doesn't report motion, so it can't be a controller. Use a phone."
						: blocked
							? "Motion access is turned off for Skill Issue. Turn on Motion & Fitness (iPhone) or physical activity / sensors (Android) for Skill Issue in Settings, then come back."
							: "Your phone is the controller: tilting walks, flicks jump and crouch, turning aims. Skill Issue needs motion access to read it."}
				</Body>
				{access === "checking" ? <Eyebrow>Checking motion access…</Eyebrow> : null}
				<View style={styles.buttons}>
					{onBack ? <SlantButton label={backLabel} small onPress={onBack} /> : null}
					{access === "ask" ? <SlantButton label="ALLOW MOTION" primary onPress={onAllow} style={styles.main} /> : null}
					{blocked && !web ? <SlantButton label="OPEN SETTINGS" primary onPress={() => void Linking.openSettings()} style={styles.main} /> : null}
					{blocked && web ? <SlantButton label="TRY AGAIN" primary onPress={onAllow} style={styles.main} /> : null}
				</View>
			</Panel>
		</View>
	);
}

const styles = StyleSheet.create({
	shade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0, 0, 0, 0.82)", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 },
	card: { width: "100%", maxWidth: 560, gap: 10, padding: 22 },
	buttons: { flexDirection: "row", gap: 12, justifyContent: "flex-end", marginTop: 6 },
	main: { minWidth: 190 },
});
