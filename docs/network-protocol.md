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
