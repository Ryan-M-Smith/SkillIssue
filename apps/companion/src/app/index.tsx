import { Platform } from "react-native";

import PhoneApp from "@/screens/phone-app";
import Landing from "@/screens/web/landing";

/**
 * Phones run the game controller app (sign in, menu, lobby, movement or aim phone).
 * The web version is the game's website: an intro, the live leaderboard and your
 * stats. The motion debugger moved to /debug.
 */
export default function Index() {
	return Platform.OS === "web" ? <Landing /> : <PhoneApp />;
}
