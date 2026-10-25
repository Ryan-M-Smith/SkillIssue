import { Platform } from "react-native";

import DebugDashboard from "@/screens/debug-dashboard";
import PhoneApp from "@/screens/phone-app";

/**
 * Phones run the game controller app (menu, lobby, movement or aim phone).
 * The web version (open it on your computer with `expo start --web`) is the
 * debugger: it shows what the phone's motion model sees, with a live 3D view.
 */
export default function Index() {
	return Platform.OS === "web" ? <DebugDashboard /> : <PhoneApp />;
}
