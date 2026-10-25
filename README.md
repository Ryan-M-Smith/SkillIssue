# SkillIssue

A 2v2 split-screen game where each team shares one character: one phone moves, the other aims and shoots. First to 10 kills wins, or the leading team after five minutes.

## Play

1. Open `apps/game` in Godot 4.7 and press **F5 / Run Project**. This opens the main menu. **F6 / Run Current Scene** runs whichever scene is open and can skip the menu.
2. Choose **Create a Lobby**. Godot hosts the WebSocket server on port 8080; no separate server process is needed. Allow local network access if prompted.
3. To run the companion from source, install Node.js 24, then run these commands from the repository root:

   ```sh
   npm install
   npm run companion:lan
   ```

4. Open the app on each phone using the Expo instructions printed in the terminal. Keep phones and the game computer on the same Wi-Fi. Choose **Join a Lobby**, enter the six-character code, pick a team and role, and tap **Ready**.
5. If automatic host detection cannot reach the game, paste the complete **lobby ticket** shown in Godot, such as `192.168.1.20:8080/T6YYH9`. It carries both the address and code; entering a WebSocket URL separately is optional.
6. All four ready phones start a three-second countdown. After the match, choose **Play Again** on the game computer to keep the lobby, or return to the main menu.

`npm run companion:start` uses an Expo tunnel when needed. That tunnel serves the app; the game connection still uses the local network and a lobby ticket. Host detection uses `EXPO_PUBLIC_GAME_SERVER` when set, otherwise the Expo LAN host or browser hostname. It never invents an IP address. Native builds also support `skillissue://join?server=<encoded-ws-url>&code=<CODE>` links.

Joining fails with a useful retry message after ten seconds. Keep the lobby open and use a fresh ticket when retrying. An HTTPS browser page needs a `wss://` host; the native app can connect directly to the local `ws://` game.

If the game loses its server session during a match, it returns to a fresh lobby. Join its new code and ready up to start again.

## Controls and practice

Hold the phone sideways, screen toward you, at a comfortable tilted angle. Hold still briefly to calibrate.

| Phone | Motion | Action |
| --- | --- | --- |
| Movement | Gentle forward/back tilt; tip either end down | Walk and strafe |
| Movement | Twist about 32 degrees like a wheel, then return to center | Toggle sprint |
| Movement | Quick flick away / toward you | Toggle crouch / jump or stand |
| Gunner | Smooth turns | Aim |
| Gunner | Short forward jab | Fire |
| Gunner | Lift upward | Reload |
| Gunner | Short pull backward | Toggle sniper scope |
| Gunner | Twist about 32 degrees, then center | Cycle owned weapons |

Wheel gestures rearm below 12 degrees with a 350 ms debounce. **Practice Controls** in the companion teaches both roles without a lobby. **Practice / Keyboard** in the Godot menu enters a local match without phones. Keyboard controls are in [the Duo README](apps/game/entities/duo/README.md); `R` reloads blue's weapon and `O` reloads red's. Hold **Tab** for the live scoreboard and press **F3** for hitboxes and weapon spread.

Weapons have real magazines: pistol **12 / 1.25 s reload**, shotgun **6 / 1.8 s**, sniper **5 / 2.2 s**. Empty magazines reload automatically. HUDs show live health, ammo and reload progress; kills build a streak that resets on death, with the best streak retained in results.

## Graphics

The default window is **1920 × 1080**. Open **Graphics** from the main menu or **Menu / Esc** during a match to set output resolution, 3D render scale, window mode and V-sync. Presets include 720p, 900p, 1080p, 2160 × 1440, 1440p (2560 × 1440), and 4K (3840 × 2160).

Render scales range from **50% to 200%**. Lower values render fewer 3D pixels and upscale the result; higher values supersample the scene. HUD text keeps its own scale. Fullscreen follows the display's desktop resolution. **Apply** saves settings between launches; **Defaults** selects 1080p at 100%.

To test with fewer phones, launch Godot with `-- --min-players=1`. To use the optional Node relay, run `npm run server:start`; Godot uses it when it already owns port 8080. An explicit game override is `-- --server=ws://host:port`.

## Development and checks

The companion's web root is the controller app. Start `npm run companion:web` and open `/debug` for the motion debugger. In phone Practice, enable the optional debug stream using the same server and room. Both the embedded server and Node relay support it.

Run from the repository root:

```sh
npm test
npm run typecheck
npm run lint
```

Node.js 24 is recommended because network tests use its built-in TypeScript stripping. `npm test` covers motion, lobby tickets, connection lifecycle, protocol authority and relay limits. Set `GODOT_BIN` to include real WebSocket tests against the embedded Godot server. Import the project first on a fresh checkout. PowerShell example:

```powershell
$env:GODOT_BIN = "C:\tools\Godot_v4.7.2-stable_win64_console.exe"
& $env:GODOT_BIN --headless --path apps/game --editor --import --quit
npm test
& $env:GODOT_BIN --headless --path apps/game --script res://tests/gameplay_smoke.gd
& $env:GODOT_BIN --headless --path apps/game --script res://tests/lifecycle_smoke.gd
```

The gameplay smoke check exercises menu navigation, practice, magazines/reloading, damage feedback, kills/streaks, respawning, scoreboard, final-shot statistics and results navigation.
The lifecycle smoke check joins with real WebSocket phones, drops the host session, and verifies that the new lobby can start a fresh match.

| Folder | Purpose |
| --- | --- |
| `apps/game` | Godot game and embedded lobby server |
| `apps/companion` | Expo phone controller, practice and `/debug` tools |
| `apps/server` | Optional Node WebSocket relay and integration tests |
| `packages/protocol` | Shared message types |
| `docs/network-protocol.md` | [Connection and message contract](docs/network-protocol.md) |
