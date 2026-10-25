import { Platform } from "react-native";

import DebugDashboard from "@/screens/debug-dashboard";
import PhoneController from "@/screens/phone-controller";

/**
 * Phones run the movement controller. The web version (open it on your
 * computer with `expo start --web`) is the debugger: it shows what the
 * phone's motion model sees, with a live 3D view.
 */
export default function Index() {
	return Platform.OS === "web" ? <DebugDashboard /> : <PhoneController />;
}
