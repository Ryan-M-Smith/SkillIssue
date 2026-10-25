# Skill Issue network protocol

Protocol version **1** is shared by the embedded Godot server, optional Node relay and Expo companion. Types are in `packages/protocol/events.ts`. The server owns pairing codes, controller IDs, slots and lobby state. Godot owns gameplay and match statistics.

## Finding a game

Every lobby lives on the Skill Issue relay (`apps/server`, deployed behind `wss://`). **Create a Lobby** asks the control plane (`network/control_plane_url`, default `https://skillissue.vodka`) for a game with `POST /api/games`, then connects to the returned `wss://…/games/<gameId>` route and receives the six-character code. There is no local fallback: if the relay can't be reached, the lobby screen shows why and offers Retry. For development, `-- --server=ws://host:port` connects to a given server, and clearing the control-plane setting hosts the lobby inside the game (`LobbyServer`, port 8080).

The Godot lobby shows only the code (**Copy Code** copies it). A phone joins with just that code: the companion asks the same control plane for the relay (`GET /api/connection`, or `EXPO_PUBLIC_GAME_SERVER` when set), connects to it, and sends `join_game` with the code. The relay finds the lobby by code on any route. App links `skillissue://join?code=<CODE>` fill in the code.

Phone joining has a **10-second** deadline and a visible retry path. Godot WebSocket connection attempts have a **6-second** deadline and reconnect with backoff. The embedded in-process transport needs no socket handshake.

## Handshake and slots

A remote game host registers with:

```json
{"type":"hello","protocolVersion":1,"clientType":"game"}
```

The server replies with `game_registered`: `gameId`, `pairingCode`, `protocolVersion` and `state`. Codes contain six characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` and are case insensitive. An already registered socket cannot register another game.

Each phone joins, selects an exclusive team/role slot and readies up:

```json
{"type":"join_game","protocolVersion":1,"pairingCode":"T6YYH9","name":"Ryan"}
{"type":"select_slot","teamId":1,"role":"movement"}
{"type":"set_ready","ready":true}
```

`lobby_joined` identifies the phone; `controller_assigned` confirms its slot. A phone may select team **1 or 2** and role **movement or aim**, giving four slots. Selection clears its ready flag. Names are limited to 16 characters. Legacy `requestedRole` joins choose the first free slot for that role and ready immediately.

`lobby_state` goes to the host and all phones after changes: `state`, `assignments`, `players` and `minPlayers`. `assignments` is authoritative for input routing; `players` also includes unassigned phones. Rejections use `join_rejected` with a code and readable message.

## Match lifecycle

`waiting` becomes `ready` when all required slots are taken and every slotted phone is ready. The host decides how many phones are required (1-4, **Settings → Player Count**, default 4): the game sends it as `minPlayers` in `hello` and with `set_min_players` when it changes, and every `lobby_state` reports it. The Node relay's `MIN_CONTROLLERS` is only the default for a host that doesn't send one. The lobby counts down three seconds, then the host sends `start_game`. The server checks readiness again and broadcasts `playing`. Repeated starts and team changes during a match are rejected.

The host sends `match_status` about once per second: two team scores, `timeLeft` and `killTarget`. At ten kills or five minutes, it sends `end_game` with `winningTeam` (or null), scores and team statistics. Phones receive `match_ended`; `lobby_state` becomes `ended`.

`end_game` and `match_ended` optionally carry `reason`: `kills`, `time`, or `host`. **End Match** uses `host` and the current score, including a draw for tied scores. Host-ended results show Main Menu rather than Play Again on both screens. When the host closes that completed lobby, phones return to their menu without a connection-error screen.

**Play Again** on the game sends `reset_lobby`: the same code and slots return to `waiting`, with ready flags cleared. Resetting a live match is rejected. A disconnected phone loses its slot and triggers `controller_disconnected`; a live match stays `playing`. Host disconnect closes the lobby and its phone sockets. Rejoining a closed lobby requires the current code; there is no automatic mid-match seat restoration.

If the game loses its host/server session while its arena is running, it stops the abandoned match and clears partial statistics, unpauses, and returns to the lobby. A newly registered code and the usual ready countdown start a fresh match. Keyboard practice is independent of this recovery path.

## Match MVP

After a match, the game posts its final numbers to the control plane, `POST /api/mvp` (not the relay): `winner` (`blue`, `red` or `draw`), `scores`, `endReason`, `durationSeconds`, and four `players` (`id` such as `red-runner`, `team`, `role` `gunner`/`runner`, `name`, numeric `stats`). Gunner stats are kills, KDR, accuracy, damage dealt, headshots, shots and best streak; Runner stats are distance, sprint time, jumps, crouches, plus the enemy's kills, accuracy and damage against that body. The route asks Gemini (`GEMINI_API_KEY`, `GEMINI_MODEL`) for structured JSON and replies `{"mvp": "<id>" | "", "headline", "reason", "model"}`; `""` (no MVP) is allowed only for a draw. It validates the report (8 KiB max) and limits each address to ten requests a minute. Any error status makes the game use its local rule. Right after the pick, the game posts `POST /api/mvp/badge` with `{"kind": "mvp", "role", "team", "headline", "reason"}` (no player name) or `{"kind": "none"}`; the route asks a Gemini image model for a square raccoon medallion or a wide no-MVP noir scene and replies with the image bytes (`image/png` or `image/jpeg`). It caches identical requests per instance and limits each address to six a minute; on any error the game draws its own. Both calls start at the final whistle, not when the results screen opens.

## Input and safety

Phones send `motion` at 30 Hz and gesture events as `environment` messages. The server derives `sender` from the socket, overwrites any claimed identity, and forwards input only during `playing`. Role ownership is checked at the server and in Godot's `InputRouter`.

```json
{"type":"motion","timestamp":1720000000000,"payload":{"controls":{"moveX":0.25,"moveY":0.5,"lookX":0,"lookY":0}}}
{"type":"environment","timestamp":1720000000001,"payload":{"action":"sprint","pressed":true}}
{"type":"environment","timestamp":1720000000002,"payload":{"action":"weapon","pressed":true,"slot":1}}
```

The actual companion also includes raw `accelerometer`, `gyroscope`, AR placeholders and `trackingStatus`. Godot prefers `controls`, whose four values must be finite and within -1..1. Without them, the legacy interpreter accepts accelerometer/gravity and gyroscope vectors. Gyroscope values on the wire are radians per second; normalized aim corresponds to 130 degrees per second.

| Role | Actions |
| --- | --- |
| Movement | `jump`, `crouch`, `sprint` |
| Aim | `shoot`, `scope`, `reload`, `weapon` |
| Either | `ready`, `interact`, `none` |

`pressed` is a boolean. Shoot, crouch and sprint follow press/release state (the gunner's FIRE button sends `shoot` pressed, then released). Jump, reload and scope act on press. Weapon slots are **0 pistol, 1 shotgun, 2 sniper**. `interact` and `none` have no gameplay effect. Sprint accelerates forward movement and is disabled while crouched.

The game clears movement and held actions after **250 ms** without valid input, on controller removal, or when gameplay closes. The phone stops replaying stale sensor intent after **300 ms**, sends zero movement/aim and releases crouch/sprint. Duplicate one-shot actions are suppressed. Both servers cap messages at **64 KiB**, connections at **32**, and each peer at **240 messages/second**. New sockets must identify within ten seconds. Invalid JSON, nonfinite sensor values, malformed payloads and unauthorized actions are rejected. Debug connections cannot drive a match.

## Motion model and weapons

Phones calibrate from a short still hold, using gravity to detect the grip. Movement has a **5-degree deadzone** and reaches full speed at **20 degrees**. Slow tilts walk/strafe; a forward flick toggles crouch and a backward flick jumps or stands up. A **32-degree wheel twist** toggles sprint without a speed threshold, rearms below **12 degrees**, and has a **350 ms** debounce. Crouch and sprint are exclusive.

The gunner (aim phone) only turns to aim: its gyro becomes `controls.lookX` / `lookY` (+X = turn right, +Y = look up, matching the game's `aim_delta`). Shooting, aiming down sights (`scope`), reloading and switching guns (`weapon` with the next owned slot) are on-screen buttons. The companion maps iOS and Android rotation-rate axes before interpreting them.

| Weapon | Magazine | Reload |
| --- | --- | --- |
| Pistol | 12 | 1.25 s |
| Shotgun | 6 | 1.8 s |
| Sniper | 5 | 2.2 s |

Firing spends one round per shot; empty magazines reload automatically. Reload blocks firing, weapon switches cancel reload, and respawn resets the loadout. Consecutive kills build a streak; death clears the current streak while `TeamStats.bestStreak` preserves the record. Accuracy counts projectiles, including shotgun pellets.

## Controller feedback

Feedback is implemented in both servers. The host sends:

```json
{"type":"to_controller","controllerId":"controller_...","message":{"t":"state","hp":75,"max_hp":100,"alive":true,"weapon":0,"owned":[true,false,false],"ammo":8,"magazine_size":12,"reloading":false,"reload_progress":0}}
```

The server permits only host-originated `state` or `buzz` messages, limited to 4096 characters, addressed to a controller in that host's lobby. The phone receives `{"type":"controller_feedback","message":{...}}`. State includes health, ownership, scope, ammo and reload progress; phone HUDs consume it and weapon cycling skips unowned weapons. `buzz` is available on the transport; device vibration is not currently implemented.

## Practice and debugging

The web root serves the same companion menu as native. `/debug` opens the separate motion debugger. Start `npm run companion:web`, open that route on the computer, and enable the optional debug stream in phone Practice with the same server and room (`debug` by default). The relay can be the running Godot lobby or `npm run server:start`. Practice itself needs neither a lobby nor a server.

| Message | Purpose |
| --- | --- |
| `debug_join` | Join a room as `phone` or `viewer`; room is 1-32 letters, digits, `_` or `-` |
| `debug_joined` | Confirm membership and supply server LAN addresses |
| `debug_status` | Report phone and viewer counts |
| `debug_motion` | Relay up to 50 finite sensor readings per message to viewers |
| `debug_event` | Relay `recalibrate` or `reset_counts` to other room members |

Godot maps protocol teams **1/2** to internal teams **0/1**, and roles `movement/aim` to `mover/gunner`. `NetworkClient` handles transport; `GameSession` mirrors assignments/state; `InputRouter` validates and routes input to `PhoneDuoController`.

Run `npm test`, `npm run typecheck` and `npm run lint` from the repository root. Node.js 24 supports the network tests' TypeScript stripping. With `GODOT_BIN` set, the network suite also tests real phones against the embedded server and checks stale-control release/reload routing. Additional smoke scripts are `res://tests/gameplay_smoke.gd` and `res://tests/lifecycle_smoke.gd`; run them with `godot --headless --path apps/game --script <script>`. See [the root README](../README.md) for setup.
