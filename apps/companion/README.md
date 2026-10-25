# Skill Issue companion

An Expo controller for Skill Issue. Each team uses a movement phone and a gunner phone, held sideways. The app includes native practice for both roles.

## Start

Use Node.js 24 and run from the repository root:

```sh
npm install
npm run companion:lan
```

Open the app on your phone using the Expo instructions in the terminal. `npm run companion:start` uses an Expo tunnel when LAN delivery is unavailable. The Expo web entry is disabled for motion controls; use `apps/landing` for browser connection information.

In Godot, open `apps/game` and press **F5** to launch the main menu, then **Create a Lobby**. Godot hosts the game server itself. **F6** runs the currently open scene and can bypass the menu.

## Join a match

1. Make sure the phone is online (Wi-Fi or mobile data).
2. Choose **Join a Lobby** and enter the six-character code from the game screen.
3. Pick a team and role, then tap **Ready**. All four ready phones start a three-second countdown.

Every lobby lives on the Skill Issue relay. The app finds it from the control plane (`https://skillissue.vodka/api/connection`; override with `EXPO_PUBLIC_CONTROL_PLANE`, or set the relay directly with `EXPO_PUBLIC_GAME_SERVER`). There is no LAN fallback and no address to type. `skillissue://join?code=<CODE>` links fill in the code.

Joining times out after ten seconds and offers a retry instead of waiting indefinitely. If the game host leaves, rejoin its new lobby. **Play Again** on the game computer keeps the existing lobby and clears ready flags.

## Motion controls

Hold the phone at a comfortable angle; it calibrates in a moment, follows slow grip changes while resting, and re-calibrates by itself after a new grip, so **Recenter** is rarely needed. Practice and the live match use the same model. Both ask for motion access explicitly (**Allow Motion**) and, when it was denied, explain how to turn it on in Settings.

The phone confirms what it did with haptics (`expo-haptics`, works in Expo Go): a tap for buttons and picks, distinct pulses for jump, crouch and the sprint twist, a heavy thump on FIRE and whenever your team takes damage (the game's existing buzz), plus cues for calibration, an empty magazine, reload done, elimination, respawn, joining, Ready, kickoff and the final result. Practice uses the same haptics.

| Role | Motion | Result |
| --- | --- | --- |
| Runner | Gentle forward/back tilt | Walk; 5-degree deadzone, full speed at 20 degrees |
| Runner | Tip an end down | Strafe |
| Runner | Twist 30 degrees, then center | Toggle sprint |
| Runner | Quick flick away / toward you | Toggle crouch / jump or stand |
| Gunner | Turn the phone left / right / up / down | Camera follows (not inverted) |
| Gunner | Hold **FIRE** | Shoot |
| Gunner | Tap **AIM** | Aim down sights / sniper scope |
| Gunner | Tap **RELOAD** | Reload |
| Gunner | Tap **SWITCH** | Next owned weapon |

Wheel gestures rearm below 12 degrees with a 350 ms debounce. Linear gunner gestures need a short pause before the next action. Gameplay actions use motion; calibration and menu controls remain touch controls.

Live health and weapon state come from the game. Magazines hold **12 pistol / 6 shotgun / 5 sniper** rounds, with reloads of **1.25 / 1.8 / 2.2 seconds**. Empty magazines reload automatically. The HUD shows ammo and reload progress. Sensor intent older than 300 ms is neutralized on the phone; the game clears held controls after 250 ms without input and when gameplay ends.

## Practice and debug

**Practice Controls** works without a lobby. Switch between movement and gunner to see live sensor feedback, gesture guides and action counts. Godot's separate **Practice / Keyboard** menu option runs a local arena without phones.

For the optional web debugger:

1. Keep a Godot lobby open or run `npm run server:start`.
2. Use the native companion for motion controls. The browser-facing connection information is in `apps/landing`.
3. Enable the debug stream in phone Practice with the same room (`debug` by default). The phone streams to the computer running the Expo dev server, or to `EXPO_PUBLIC_GAME_SERVER` when set; there is no server field in the app.

## Check changes

Run from the repository root:

```sh
npm test
npm run typecheck
npm run lint
```

The test suite covers calibrated movement/gestures, joining and retry cleanup, lobby codes and relay lookup, feedback and network authority. Set `GODOT_BIN` to a Godot executable to enable the embedded-server integration tests; import `apps/game` first on a fresh checkout. Node.js 24 is recommended for the network tests' native TypeScript support. The [root README](../../README.md) includes the headless gameplay smoke command and keyboard controls; [the protocol document](../../docs/network-protocol.md) details the wire messages.
