# SkillIssue Network Protocol

The Node.js server is authoritative for game sessions, pairing codes, controller IDs, team assignments, roles, and connection state. Godot is the game host. Mobile clients request a role and send input only after receiving a server-issued assignment.

## Controller slots

The server exposes four exclusive slots:

| Team | Role | Responsibility |
| --- | --- | --- |
| 1 | `movement` | Move, jump, crouch, sprint |
| 1 | `aim` | Aim and shoot |
| 2 | `movement` | Move, jump, crouch, sprint |
| 2 | `aim` | Aim and shoot |

## Handshake

Godot registers a game host:

```json
{"type":"hello","protocolVersion":1,"clientType":"game"}
```

The server replies with `game_registered`, including `gameId`, `pairingCode`, and `state`.

A mobile client joins with a requested role:

```json
{"type":"join_game","protocolVersion":1,"pairingCode":"482917","requestedRole":"movement"}
```

The server replies to the phone and game with `controller_assigned`. The server, not the phone, supplies `controllerId` and `teamId`.

## Lifecycle

The server reports `waiting` until all four slots are assigned, then `ready`. Godot requests the transition to `playing` with:

```json
{"type":"start_game","protocolVersion":1}
```

The server accepts that request only from the registered game host and only when all four slots are occupied. It then broadcasts the authoritative state.

## Input authority

Controllers send `motion` or `environment` messages without a trusted sender field. The server derives `sender` from the authenticated WebSocket connection and forwards authorized input only to Godot. Input sent before `playing` is rejected with a structured error.

When a controller disconnects, the server sends `controller_disconnected` to the game, removes the slot, and returns the lobby to `waiting`. If the game host disconnects, the session is invalidated and controller connections are closed.

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
- **`controls`** in the motion payload (`moveX`, `moveY`, `lookX`, `lookY`, each −1..1) if the companion prefers to send its own computed values. Godot uses them over raw readings when present.
