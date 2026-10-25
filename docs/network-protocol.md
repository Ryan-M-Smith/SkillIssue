# SkillIssue network protocol

Protocol version **1** is shared by the embedded Godot server, optional Node relay and Expo companion. Types are in `packages/protocol/events.ts`. The server owns pairing codes, controller IDs, slots and lobby state. Godot owns gameplay and match statistics.

## Finding a game

**Create a Lobby** starts `LobbyServer` inside Godot on port 8080 and attaches `NetworkClient` in-process. Phones use WebSocket connections. If the Node relay already holds that port, Godot connects to it instead. `-- --server=ws://host:port` or the `network/server_url` project setting overrides the game server.

The companion chooses a host in this order: `EXPO_PUBLIC_GAME_SERVER`, browser hostname on web, or the Expo LAN host on a phone. When none is available, it leaves the host unset. A six-character code works when that host is reachable. The Godot lobby also displays and copies a complete ticket:

```text
192.168.1.20:8080/T6YYH9
```

The phone accepts that ticket, `ws://host:port/CODE`, or a registered app link such as `skillissue://join?server=ws%3A%2F%2F192.168.1.20%3A8080&code=T6YYH9`. The ticket is parsed locally into the server URL and pairing code; the wire protocol still sends only the code. `companion:` app links are also accepted. Expo tunnels do not tunnel the game server. Phones and the host must be able to reach one another; HTTPS browser pages require `wss://`.

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

`waiting` becomes `ready` when all required slots are taken and every slotted phone is ready. Normally four phones are required; use Godot's `-- --min-players=1` or the Node relay's `MIN_CONTROLLERS=1` for testing. The lobby counts down three seconds, then the host sends `start_game`. The server checks readiness again and broadcasts `playing`. Repeated starts and team changes during a match are rejected.

The host sends `match_status` about once per second: two team scores, `timeLeft` and `killTarget`. At ten kills or five minutes, it sends `end_game` with `winningTeam` (or null), scores and team statistics. Phones receive `match_ended`; `lobby_state` becomes `ended`.

**Play Again** on the game sends `reset_lobby`: the same code and slots return to `waiting`, with ready flags cleared. Resetting a live match is rejected. A disconnected phone loses its slot and triggers `controller_disconnected`; a live match stays `playing`. Host disconnect closes the lobby and its phone sockets. Rejoining a closed lobby requires the current code; there is no automatic mid-match seat restoration.

If the game loses its host/server session while its arena is running, it stops the abandoned match and clears partial statistics, unpauses, and returns to the lobby. A newly registered code and the usual ready countdown start a fresh match. Keyboard practice is independent of this recovery path.

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

`pressed` is a boolean. Shoot, crouch and sprint follow press/release state; a jab fires a 120 ms shoot pulse. Jump, reload and scope act on press. Weapon slots are **0 pistol, 1 shotgun, 2 sniper**. `interact` and `none` have no gameplay effect. Sprint accelerates forward movement and is disabled while crouched.

The game clears movement and held actions after **250 ms** without valid input, on controller removal, or when gameplay closes. The phone stops replaying stale sensor intent after **300 ms**, sends zero movement/aim and releases crouch/sprint. Duplicate one-shot actions are suppressed. Both servers cap messages at **64 KiB**, connections at **32**, and each peer at **240 messages/second**. New sockets must identify within ten seconds. Invalid JSON, nonfinite sensor values, malformed payloads and unauthorized actions are rejected. Debug connections cannot drive a match.

## Motion model and weapons

Phones calibrate from a short still hold, using gravity to detect the grip. Movement has a **5-degree deadzone** and reaches full speed at **20 degrees**. Slow tilts walk/strafe; a forward flick toggles crouch and a backward flick jumps or stands up. A **32-degree wheel twist** toggles sprint without a speed threshold, rearms below **12 degrees**, and has a **350 ms** debounce. Crouch and sprint are exclusive.

The gunner turns to aim, jabs forward to shoot, lifts upward to reload, pulls back to toggle scope, and uses the same wheel gesture to cycle owned weapons. A short still interval rearms linear gestures and prevents the return swing from firing twice. The companion maps iOS and Android rotation-rate axes before interpreting them.

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
