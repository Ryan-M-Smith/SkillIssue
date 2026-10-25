# SkillIssue Network Protocol

The server is authoritative for game sessions, pairing codes, controller IDs, team assignments, roles, and connection state. It runs inside the Godot game (`apps/game/scripts/network/lobby_server.gd`); `apps/server/index.ts` is the same server in Node.js. Godot is the game host. Mobile clients request a role and send input only after receiving a server-issued assignment.

## Controller slots

The server exposes four exclusive slots:

| Team | Role | Responsibility |
| --- | --- | --- |
| 1 | `movement` | Move, jump, crouch, sprint |
| 1 | `aim` | Aim and shoot |
| 2 | `movement` | Move, jump, crouch, sprint |
| 2 | `aim` | Aim and shoot |

## Handshake and lobby

Godot registers a game host:

```json
{"type":"hello","protocolVersion":1,"clientType":"game"}
```

The server replies with `game_registered`, including `gameId`, `pairingCode` (6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, entered case-insensitively) and `state`.

A phone joins with the code and a display name, then picks a spot and readies up:

```json
{"type":"join_game","protocolVersion":1,"pairingCode":"T6YYH9","name":"Ryan"}
{"type":"select_slot","teamId":1,"role":"movement"}
{"type":"set_ready","ready":true}
```

The server answers `lobby_joined` (`controllerId`) and `controller_assigned` when a spot is taken; a taken spot is rejected with the holder's name. A lobby holds 4 phones. Older clients may still send `requestedRole` in `join_game`: they get the first free spot for that role, already ready.

Every change sends `lobby_state` to everyone: `state`, `assignments` (phones holding a spot, what the game routes input by), `players` (every phone: name, team, role, ready) and `minPlayers`.

## Lifecycle

`waiting` → `ready` when all four spots are taken and every phone holding one is ready (or the game's `--min-players` / the Node server's `MIN_CONTROLLERS` phones, for testing). The game counts down 3 s and sends `start_game`; the server checks readiness again and broadcasts `playing`. Teams are locked while playing.

While playing, the game sends `match_status` (`scores` for teams 1 and 2, `timeLeft`, `killTarget`) every second; the server passes it to the phones. A match ends at 10 kills or after 5 minutes: the game sends `end_game` (`winningTeam` or null for a draw, `scores`, per-team `stats`), the server moves to `ended` and sends the phones `match_ended`. Input after that is ignored. **Play Again** on the game sends `reset_lobby`: back to `waiting` with the same code and spots, everyone un-readied.

When a phone disconnects, the server removes it and tells the game (`controller_disconnected`). If the game host disconnects, the lobby is closed and the phones are disconnected.

## Who starts the server

The game hosts it. **Create a Lobby** (`GameSession.create_lobby`) asks the `LobbyServer` autoload to listen on port 8080 (all network interfaces), then the game hosts the lobby on it in-process: `NetworkClient.connect_local()` passes the host's messages straight to `LobbyServer` and gets back exactly what a remote server would send. Phones connect over WebSocket as usual. No Node.js or separate process; the server stops with the game.

If another server already holds port 8080 (for example `npm run server:start`), the game connects to it over WebSocket instead. `-- --server=ws://host:port` connects to a specific server. To test with fewer than four phones, run the game with `-- --min-players=1` (or set `LobbyServer.min_players`).

## Input authority

Controllers send `motion` or `environment` messages without a trusted sender field. The server derives `sender` from the authenticated WebSocket connection and forwards authorized input only to Godot. Input sent before `playing` is rejected with a structured error.

When a controller disconnects, the server sends `controller_disconnected` to the game, removes the slot, and returns the lobby to `waiting`. If the game host disconnects, the session is invalidated and controller connections are closed.

## Companion movement phone

The companion app runs in landscape, held like a controller: Main Menu → Join a Lobby → Enter Code → Team + Role Select → Ready → in-match screen for its role → Game Over. A **movement** phone sends, once the match is `playing`:

- `motion` at 30 Hz with `payload.controls` (`moveX`, `moveY` from the phone's own motion model, `lookX`/`lookY` 0) plus the raw `accelerometer` (with gravity, m/s²) and `gyroscope` (phone axes, rad/s). Godot uses `controls` when present.
- `environment` `jump` with `pressed: true` for each jump.
- `environment` `crouch` and `sprint` with `pressed` set to the new state each time it changes, and once more when the match starts, so the game's held states match the phone.

An **aim** phone sends `motion` with `controls.lookX`/`lookY` (its gyro, −1..1 = ±130°/s) and `environment` `shoot` (`pressed` true/false: a forward jab is a 120 ms tap, the FIRE button is held), `scope` and `weapon` (`slot` 0 pistol, 1 shotgun, 2 sniper).

## Debug relay (phone to web debugger)

A separate, game-free channel for debugging the movement phone. It needs no Godot host, pairing code or slots, and debug connections can't send game input or join a game.

1. Start the server: `npm run server:start` (or open a lobby in the game, whose server relays debug rooms too). It prints the `ws://` addresses it can be reached on from your network.
2. Open the companion's web version on the computer: `npm run companion:web` (or press `w` in a running Expo dev server). The web version is the **Motion Debugger**; it connects to `ws://<this page's host>:8080`, room `debug`.
3. On the phone, open the companion (it shows the simplified **Controller** screen), enter one of the printed addresses and the same room, and tap **Connect**. The phone and computer must be on the same network.

The phone runs the motion model itself and streams its raw DeviceMotion readings. The web version runs the same model on that stream, so it shows exactly what the phone computes, plus a 3D view of the phone in the player's frame (pitch, side and twist axes, and gravity).

| Message | From | To | Payload |
| --- | --- | --- | --- |
| `debug_join` | phone or viewer | server | `protocolVersion`, `room` (1-32 letters, digits, `_`, `-`), `role`: `phone` or `viewer` |
| `debug_joined` | server | that client | `room`, `role`, `addresses` (`ws://` LAN addresses) |
| `debug_status` | server | everyone in the room | `phones`, `viewers` (sent on every join and leave) |
| `debug_motion` | phone | viewers | `platform` (the phone's `Platform.OS`), `readings` (up to 50 DeviceMotion readings with sensor timestamps) |
| `debug_event` | anyone | everyone else in the room | `event`: `recalibrate` or `reset_counts` |

Types are in `packages/protocol/events.ts` (`Debug*`).

## Godot client

Implemented in `apps/game` against this server (`apps/server/index.ts`) and `packages/protocol/events.ts`.

| File | Autoload | Job |
| --- | --- | --- |
| `scripts/network/network_client.gd` | `NetworkClient` | Socket lifecycle, reconnect with backoff, JSON validation, stats. URL: `network/server_url` Project Setting or `-- --server=ws://host:port`, default `ws://127.0.0.1:8080` |
| `scripts/game_session.gd` | `GameSession` | Pairing code, lobby state, controller table rebuilt from `lobby_state.assignments` |
| `scripts/input_router.gd` | `InputRouter` | Routes `motion` / `environment` by the server-stamped `sender`, enforces role ownership, feeds `PhoneDuoController` |
| `scripts/network/motion_interpreter.gd` | (none) | `MotionReading` to move/aim. Tilt from `accelerometer` (needs gravity included), aim from `gyroscope` (rad/s assumed); tune axes here |
| `scripts/network/sim_controllers.gd` | (none) | Four simulated phones for testing without a server |

How Godot reads the server's messages:

- Teams `1` / `2` become game teams `0` (blue, left screen) / `1` (red, right screen). Roles `movement` / `aim` become `mover` / `gunner` internally.
- `lobby_state` is the source of truth for assignments; `controller_disconnected` clears that controller's held input immediately.
- Input from a `sender` that isn't in the current assignments is dropped. So is input a role doesn't own: the aim phone can't `jump`, the movement phone can't `shoot`.
- `pressed` on `environment` drives held controls (`shoot`, `crouch`, `sprint`). `jump` fires on press only. A `sprint` without `pressed` toggles sprint. `reload` and `interact` are accepted but not implemented in the game yet.
- Sprint only speeds up forward movement and is ignored while crouched.
- A message with an unknown `type` or invalid JSON is counted and ignored.

## Movement phone gestures

The companion (`apps/companion/src/service/motion-control-service.ts`) turns phone motion into these controls. The phone is held in landscape with both hands, like a controller, tilted about 45° with the screen toward the player (portrait also works). The pose it is held still in at start is neutral, and gravity at that moment tells the companion which grip is in use, so the axes below are relative to the player, not fixed phone axes. Slow, held tilts move; fast motions are gestures, recognised from the gyroscope by whichever axis dominates.

| Axis | Phone motion | Game control | Message |
| --- | --- | --- | --- |
| Pitch | Slowly tilt the top edge away / toward you and hold | Walk forward / backward | `motion` (`moveY`) |
| Pitch | Quick flick forward | Crouch on, flick again for off | `environment` `crouch`, `pressed` = new state |
| Pitch | Quick flick back | Jump. While crouched it only stands up | `environment` `jump`, `pressed: true` (or `crouch`, `pressed: false`) |
| Yaw | Slowly tip the right / left end down and hold | Strafe right / left | `motion` (`moveX`) |
| Roll / Z | Quick twist in the plane of the screen | Sprint on, twist again for off | `environment` `sprint`, `pressed` = new state |
| | Back to neutral | Stop | `motion` (zero) |

Only one gesture registers per motion, then gestures are locked for 1 s, and a gesture's own motion never becomes walking. Crouch and sprint are exclusive: starting one ends the other.

expo-sensors orders `DeviceMotion.rotationRate` differently per platform (iOS: alpha = z, beta = y, gamma = x; Android: alpha = x, beta = y, gamma = z). The companion maps it to the phone's X / Y / Z axes before using it.

### Proposed additions (not in the server yet)

- **Phone feedback.** `PhoneDuoController` wants to send health/weapon state and a hit vibration to each team's phones. The server currently rejects unknown types, so Godot keeps this off (`InputRouter.feedback_enabled = false`). Proposal: Godot sends `{"type":"to_controller","controllerId":"...","message":{...}}`, the server forwards `message` to that controller.
- **`scope` and `weapon` actions** for the aim phone (`weapon` with a `slot` number: 0 pistol, 1 shotgun, 2 sniper). Godot already accepts them.
- (Implemented) **`controls`** in the motion payload (`moveX`, `moveY`, `lookX`, `lookY`, each −1..1). The companion's movement phone sends them; Godot uses them over raw readings when present.
