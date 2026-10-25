import { Redirect } from "expo-router";
import { Platform, Text, View } from "react-native";

import { ui } from "@/screens/phone/theme";

/**
 * Where Auth0 sends the browser back after sign-in. On the web this page runs in
 * the sign-in popup, hands the result to the page that opened it and closes
 * (see lib/account/account.tsx). On phones the app catches the redirect itself.
 */
export default function AuthCallback() {
	if (Platform.OS !== "web") return <Redirect href="/" />;
	return (
		<View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: ui.bg }}>
			<Text style={{ color: ui.muted, fontSize: 16 }}>Signing you in…</Text>
		</View>
	);
}
