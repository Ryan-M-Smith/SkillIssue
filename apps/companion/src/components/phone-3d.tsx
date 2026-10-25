import { StyleSheet, Text, View } from "react-native";

import type { Phone3DProps } from "./phone-3d.types";

export type { Phone3DPose, Phone3DProps } from "./phone-3d.types";

/** The 3D view draws on a web canvas; on phones it shows a note instead. */
export default function Phone3D(_props: Phone3DProps) {
	return (
		<View style={styles.box}>
			<Text style={styles.text}>The 3D view is available in the web version.</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	box: { padding: 16, borderRadius: 10, backgroundColor: "#1D2A40" },
	text: { color: "#99AAC6", fontSize: 12 },
});
