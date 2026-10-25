import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from "expo-router";
import Head from "expo-router/head";
import { useFonts } from "expo-font";
import { useColorScheme } from "react-native";

import { fontAssets } from "@/screens/phone/theme";

export default function RootLayout() {
	const colorScheme = useColorScheme();
	const [fontsLoaded, fontError] = useFonts(fontAssets);

	// Show the app once the fonts are in (or failed: then system fonts are used).
	if (!fontsLoaded && !fontError) {
		return null;
	}

	return (
		<ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
			<Head><title>Skill Issue</title></Head>
			<Slot/>
		</ThemeProvider>
	);
}
