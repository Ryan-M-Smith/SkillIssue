# Skill Issue implementation report

Date: October 25, 2026

## Branches

- Merged `claude/fancy-ui` into `main`, retaining the hitbox/spread work already merged from `hitboxes-spread`. Resolved both sandbox conflicts by preserving the match flow and hitbox debugging.
- Pushed the merge to `main` at `da3c13a`.
- Deleted the remote `claude/fancy-ui` and `hitboxes-spread` branches after the merge.
- Implementation branch: [`codex/fancy-ui`](https://github.com/Ryan-M-Smith/SkillIssue/tree/codex/fancy-ui).
- Final integration target: [`main`](https://github.com/Ryan-M-Smith/SkillIssue/tree/main), including the host controls and visible-name follow-ups.

## Requested changes

| Request | Implementation |
| --- | --- |
| Remove corner team text | Removed the redundant team titles from each split-screen viewport; team colors remain in the central scoreboard and health accents. |
| Improve HP bars | Segmented health meters with numeric HP, animated damage trails, flashes, and a critical-health vignette. |
| Weapon icons, ammo and reload | Distinct weapon silhouettes, owned-weapon slots, ammo/max magazine counters, and a circular reload indicator. Added real magazine and reload mechanics throughout the input path. |
| Start at the main menu | F5 launches `ui/main_menu.tscn`. Added keyboard practice and an Escape/menu overlay with Resume, Graphics and End Match. Offline practice pauses; live matches continue while their menu is open. Ending early shows final results before returning to the main menu. F6 intentionally runs the scene open in the editor. |
| Remove mandatory server URL entry | Automatic host selection from the Expo LAN host, browser hostname, or `EXPO_PUBLIC_GAME_SERVER`; a single copyable lobby ticket carries the host and code when needed. Removed the fabricated IP fallback. |
| More responsive motion controls | Calibration takes 450 ms; movement has a 5-degree deadzone and reaches full speed at 20 degrees. Sprint toggles at a 32-degree wheel twist, rearms below 12 degrees, and has a 350 ms debounce. |
| Motion-driven gunner | Jab forward to fire, lift to reload, pull back to scope, and twist to cycle owned weapons. Replaced combat buttons with gesture guidance and live status; retained Recenter. |
| Cohesive practice UI | Rebuilt practice with the shared fonts, panels, colors, live motion feedback, and guides for both roles. Debug streaming remains optional. |
| Stuck joining | Ten-second phone join deadline, immediate connection-error recovery, six-second Godot connection deadline, retry/cancel, stale socket guards, and stricter malformed-message handling. Losing the host session aborts the old match and returns to a working lobby with a fresh countdown. |
| Flashier kill/death UI and streaks | Animated eliminations, hit/headshot feedback, death and respawn countdowns, live streak celebrations, and best streak in match results. Death resets the current streak. |
| Cohesive scoreboard | Compact central scores, timer and kill target; hold Tab for the detailed live scoreboard. Results use the same styling and a scrollable statistics table. |
| Quality and security pass | Role and sender authority, finite/bounded input validation, packet/connection/rate limits, socket cleanup, stale-input release, safe sensor subscription cancellation, lint configuration, regression tests, and updated documentation. |

## Graphics settings

The game defaults to **1920 × 1080**. Graphics controls are available from the main menu and the in-game menu, with saved output resolution and separate 3D render scaling. Lower render scale reduces rendering work; higher render scale supersamples the scene while the HUD remains sharp.

Resolution presets include 1280 × 720, 1600 × 900, 1920 × 1080, 2160 × 1440, 2560 × 1440, and 3840 × 2160. **3840 × 2160 is standard 4K**; the separately requested 2160 × 1440 size is included as its own preset.

Render scales range from 50% to 200%. Windowed, fullscreen, borderless-window and V-sync controls are included. Apply saves to `user://graphics.cfg`; Defaults selects 1080p at 100%. Fullscreen follows the display's desktop resolution. The Compatibility renderer uses bilinear scaling, with full-size split-screen textures at 100%.

## Host menu follow-up

Visible branding is consistently **Skill Issue** in Godot, companion titles, debugger text, instructions, permission prompts, and the browser title. Package identifiers and the `skillissue://` link scheme remain compatible. Native app display names/permission text apply when the installed app is rebuilt.

Menus keep the mouse visible and accept actual mouse clicks. Phone matches never attach desktop gameplay controllers, and the keyboard controller also rejects live-session input defensively. Keyboard movement/shooting and hitbox debugging remain available in local practice.

During a live match, **Menu / Esc** offers settings and **End Match**. Ending early uses the existing match-end path: the leading score wins, equal scores draw, final statistics and phone results are preserved, and the standard winner banner/results screen appears. Those results offer **Main Menu**, closing the lobby; Play Again is reserved for normally completed matches. The host menu is disabled once the match finishes so it cannot interfere with the final transition.

Phones receive the host-end reason too, hide the unavailable replay action, and return to their main menu when the host closes the completed lobby.

## Use the new connection flow

1. Launch Godot with F5 and choose **Create a Lobby**.
2. Keep the game computer and phones on the same Wi-Fi.
3. Run `npm run companion:lan` and open the companion app. Its browser root now also opens the controller; `/debug` opens the debugger.
4. Enter the six-character code when host detection finds the game. Otherwise use **Copy Lobby Ticket** in Godot and paste the full ticket into the same phone field, for example `192.168.1.20:8080/ABC123`.
5. Choose a team and role, then ready up. All four ready phones start the countdown. For solo testing, launch Godot with `-- --min-players=1`.

HTTPS browser pages require a secure `wss://` host. Native phones can connect directly to the local `ws://` lobby. Custom `skillissue://` links require a native build that includes the configured scheme; adding native configuration requires rebuilding an existing development/release app.

## Validation

Reproducible checks from the repository root:

```sh
npm run typecheck
npm run lint
npm test
npm run test:game
```

Set `GODOT_BIN` to a Godot 4.7 executable for the embedded-server integration test and `test:game`. The latter imports the project and runs the production-scene gameplay checks, failing on engine errors or failed assertions. Node.js 24 is recommended for the network tests.

- Companion and server TypeScript checks passed.
- Full companion lint passed with zero warnings.
- All **24 motion/lobby regression tests** passed, including comfortable sprint, gesture rearming, invalid readings, ticket parsing, joining timeout/retry, obsolete socket events, ownership-aware weapon switching, stale sensor release, pause/resume, and clean closure of host-ended results.
- All **3 network integration tests** passed against the Node relay and real embedded-Godot WebSockets, including four simulated phone clients, assignment authority, malformed versions, input validation, feedback, starting, ending, replay, and stale held-input release.
- **58 headless gameplay checks** passed for real firing, manual/automatic reload, switching during reload, damage feedback, kills/streaks, respawn, mouse/Tab/Escape input, final-shot statistics, results, menu navigation, host-ended draws, graphics persistence, validated defaults, and output/render scaling.
- All **25 host-session lifecycle checks** passed, including loss while paused, a fresh lobby/code, rejoining, a second real countdown, disabled host gameplay controls, host-ended winner/reason delivery to phones, results-to-main-menu navigation, and unaffected keyboard practice.
- Expo exports for **web, Android, and iOS** passed, including web server/client bundles and native JavaScript/assets. These exports do not constitute device builds or physical phone tests.
- Godot UI was rendered and inspected at 1280 × 720, including the HUD, damage/death screens, scoreboard, results, menu, instructions, and populated lobby.
- The companion menu and practice were rendered and inspected in Chrome at 844 × 390. Fixed a web hydration mismatch so the practice layout switches correctly to landscape after hydration.

## Previews

Split-screen HUD:

![Split-screen HUD with segmented health and weapon ammo](previews/hud.png)

Graphics settings:

![Graphics settings with 4K and independent render scale](previews/graphics.png)

Companion practice, captured on desktop without phone sensors:

![Landscape companion practice and gesture guide](previews/companion-practice.png)

## Remaining limits

The final audit covered every requested implementation and both follow-ups. All requested code changes are complete. Automated checks, engine scenarios, typechecks, lint, exports and whitespace validation pass; the physical-device and upstream dependency limits below remain explicit.

- Physical Android/iOS motion ergonomics, permissions, and Wi-Fi latency still need hands-on testing. Synthetic sensor regressions and real local WebSocket tests do not replace a four-phone playtest. Hold the phone tilted toward you: a face-up grip cannot reliably measure wheel rotation from gravity.
- Lost controllers release held actions promptly. Automatic restoration of a disconnected phone's previous seat during an active match is not implemented.
- Reloads use unlimited reserve ammunition; magazine sizes are pistol 12, shotgun 6, sniper 5, with reload times of 1.25, 1.8, and 2.2 seconds respectively.
- Buzz messages are transported, but physical phone vibration is not implemented.
- `npm audit` reports five high-severity entries in the upstream Expo tooling dependency chain. [The node-forge advisory has no patched release](https://github.com/advisories/GHSA-86w9-cpqp-85rv). [The Zod fix is in version 4.6.6](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), while this Expo CLI uses Zod 3. An incompatible Expo downgrade or forced Zod major override was not applied. These advisories remain open.

The setup instructions and protocol contract are updated in [README.md](../README.md), [the companion README](../apps/companion/README.md), and [network-protocol.md](network-protocol.md).
