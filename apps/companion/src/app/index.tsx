import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import MotionTest from "@/components/motion-test";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";

export default function HomeScreen() {
	return (
		<ThemedView style={styles.container}>
			<SafeAreaView style={styles.safeArea}>
				<ThemedText type="title" style={styles.title}>
					Companion App
				</ThemedText>

				<MotionTest />
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
		maxWidth: MaxContentWidth,
	},

	title: {
		textAlign: "center",
	}
});
