import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** Small key/value storage: the phone's keychain, or the browser's localStorage. */
export const storage = {
	async get(key: string): Promise<string | null> {
		if (Platform.OS === "web") {
			try {
				return globalThis.localStorage?.getItem(key) ?? null;
			} catch {
				return null;
			}
		}
		return SecureStore.getItemAsync(key).catch(() => null);
	},
	async set(key: string, value: string | null): Promise<void> {
		if (Platform.OS === "web") {
			try {
				if (value === null) globalThis.localStorage?.removeItem(key);
				else globalThis.localStorage?.setItem(key, value);
			} catch {
				// private mode / blocked storage: stay signed in for this visit only
			}
			return;
		}
		if (value === null) await SecureStore.deleteItemAsync(key).catch(() => {});
		else await SecureStore.setItemAsync(key, value).catch(() => {});
	},
};
