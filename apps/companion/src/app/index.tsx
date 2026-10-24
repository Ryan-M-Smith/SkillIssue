import * as Device from "expo-device";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import MotionTest from "@/components/motion-test";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";

function getDevMenuHint() {
	if (Platform.OS === "web") {
		return <ThemedText type="small">use browser devtools</ThemedText>;
	}
	if (Device.isDevice) {
		return (
			<ThemedText type="small">
				shake device or press <ThemedText type="code">m</ThemedText> in terminal
			</ThemedText>
		);
	}
	const shortcut = Platform.OS === "android" ? "cmd+m (or ctrl+m)" : "cmd+d";
	return (
		<ThemedText type="small">
			press <ThemedText type="code">{shortcut}</ThemedText>
		</ThemedText>
	);
}

export default function HomeScreen() {
	return (
		<ThemedView style={styles.container}>
			<SafeAreaView style={styles.safeArea}>
				<ThemedView>
					<ThemedText type="title" style={styles.title}>
						Companion App
					</ThemedText>
				</ThemedView>

				<MotionTest/>
			</SafeAreaView>
		</ThemedView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		flexDirection: "row",
	},

	safeArea: {
		flex: 1,
		paddingHorizontal: Spacing.four,
		alignItems: "center",
		gap: Spacing.three,
		paddingBottom: BottomTabInset + Spacing.three,
		maxWidth: MaxContentWidth,
	},

	title: {
		textAlign: "center",
	},

	code: {
		textTransform: "uppercase",
	}
});
