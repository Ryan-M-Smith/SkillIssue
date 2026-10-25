# SkillIssue companion

An Expo controller for SkillIssue. Each team uses a movement phone and a gunner phone, held sideways. The same app includes practice for both roles and a web motion debugger at `/debug`.

## Start

Use Node.js 24 and run from the repository root:

```sh
npm install
npm run companion:lan
```

Open the app on your phone using the Expo instructions in the terminal. `npm run companion:start` uses an Expo tunnel when LAN delivery is unavailable. `npm run companion:web` opens the web app; its root is the regular controller menu.

In Godot, open `apps/game` and press **F5** to launch the main menu, then **Create a Lobby**. Godot hosts the game server itself. **F6** runs the currently open scene and can bypass the menu.

## Join a match

1. Keep the phone and game computer on the same Wi-Fi.
2. Choose **Join a Lobby** and enter the six-character lobby code.
3. Pick a team and role, then tap **Ready**. All four ready phones start a three-second countdown.

The app finds the host from `EXPO_PUBLIC_GAME_SERVER`, the browser hostname, or the Expo LAN host. The last two work when the game runs on that computer. If detection is unavailable, paste the full ticket shown in the Godot lobby, such as `192.168.1.20:8080/T6YYH9`. There is no fabricated fallback IP or mandatory URL field; Settings provides an optional host override.

The input also accepts `ws://host:port/CODE`. Native builds registered with the app's schemes support `skillissue://join?server=<encoded-ws-url>&code=<CODE>` and `companion:` links. An Expo tunnel delivers the app but does not expose the local game server. HTTPS browser pages require `wss://`; use the native app for a direct local `ws://` connection.

Joining times out after ten seconds and offers a retry instead of waiting indefinitely. Keep the lobby open and copy a fresh ticket if needed. If the game host leaves, rejoin its new lobby. **Play Again** on the game computer keeps the existing lobby and clears ready flags.

## Motion controls

Hold still briefly at a comfortable angle to calibrate. Practice and the live match use the same model. Use **Recenter** when the neutral pose needs adjusting.

| Role | Motion | Result |
| --- | --- | --- |
| Movement | Gentle forward/back tilt | Walk; 5-degree deadzone, full speed at 20 degrees |
| Movement | Tip an end down | Strafe |
| Movement | Twist 32 degrees, then center | Toggle sprint |
| Movement | Quick flick away / toward you | Toggle crouch / jump or stand |
| Gunner | Smooth turns | Aim |
| Gunner | Short forward jab | Fire |
| Gunner | Lift upward | Reload |
| Gunner | Pull back | Toggle sniper scope |
| Gunner | Twist 32 degrees, then center | Cycle owned weapons |

Wheel gestures rearm below 12 degrees with a 350 ms debounce. Linear gunner gestures need a short pause before the next action. Gameplay actions use motion; calibration and menu controls remain touch controls.

Live health and weapon state come from the game. Magazines hold **12 pistol / 6 shotgun / 5 sniper** rounds, with reloads of **1.25 / 1.8 / 2.2 seconds**. Empty magazines reload automatically. The HUD shows ammo and reload progress. Sensor intent older than 300 ms is neutralized on the phone; the game clears held controls after 250 ms without input and when gameplay ends.

## Practice and debug

**Practice Controls** works without a lobby. Switch between movement and gunner to see live sensor feedback, gesture guides and action counts. Godot's separate **Practice / Keyboard** menu option runs a local arena without phones.

For the optional web debugger:

1. Keep a Godot lobby open or run `npm run server:start`.
2. Start `npm run companion:web` and open `/debug` on the computer.
3. Enable the debug stream in phone Practice; use the same server and room (`debug` by default).

## Check changes

Run from the repository root:

```sh
npm test
npm run typecheck
npm run lint
```

The test suite covers calibrated movement/gestures, joining and retry cleanup, tickets, feedback and network authority. Set `GODOT_BIN` to a Godot executable to enable the embedded-server integration tests; import `apps/game` first on a fresh checkout. Node.js 24 is recommended for the network tests' native TypeScript support. The [root README](../../README.md) includes the headless gameplay smoke command and keyboard controls; [the protocol document](../../docs/network-protocol.md) details the wire messages.
