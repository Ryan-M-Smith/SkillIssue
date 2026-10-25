# Internet connection

The live game protocol remains WebSocket-based. Tiger Data is not a WebSocket relay: use it for durable accounts, match records, and telemetry after the live socket has delivered the event.

## Recommended deployment

Run the standalone Node relay on a public host and put a TLS reverse proxy in front of it:

```text
phone --wss://game.example.com--> Caddy/Nginx --ws://127.0.0.1:8080--> apps/server
Godot host ---------------------> the same public endpoint
```

The Godot game must launch against the relay instead of hosting only its embedded LAN server:

```sh
npm run server:start
# or from a process manager:
PUBLIC_WS_URL=wss://game.example.com npm run server:start
```

For Render, use npm from the repository root. No pnpm or Corepack setup is required:

```text
Build: npm install
Start: npm run server:start
```

Start Godot with the external server override:

```text
-- --server=wss://game.example.com
```

Point the GoDaddy DNS `A` record for `game.example.com` at the public host. A free DNS name alone cannot expose a computer behind a home router; the relay must run on a public VM/container or the router must forward port 443.

## Caddy

Caddy automatically provisions the certificate and forwards WebSocket upgrades:

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Run the relay with `PUBLIC_WS_URL=wss://game.example.com` so the endpoint is visible in startup logs. Set the companion build/runtime variable to the same value when users enter only a lobby code:

```sh
EXPO_PUBLIC_GAME_SERVER=wss://game.example.com npm run companion:start
```

The Vercel app exposes the current public connection metadata at `/api/connection`. Godot or an admin surface can use that HTTP endpoint to discover the configured relay, but the actual motion stream must connect directly to the returned `wss://` URL.

Godot can provision a session by sending `POST /api/games`. The response contains a UUID `gameId` and a route such as `wss://game.example.com/games/<gameId>`. Godot connects to that route, receives the normal six-character pairing code, and shows just that code. Phones look up the same relay from `/api/connection` and join with the code. Set the Godot `network/control_plane_url` project setting or launch with `-- --control-plane=https://landing.example.com`.

The companion retries transient socket failures with exponential backoff and replays its selected team, role, and ready state after reconnecting.

## Local fallback

For local development, run the relay with `npm run server:start`, start Godot with `-- --server=ws://<your-ip>:8080`, and the companion with `EXPO_PUBLIC_GAME_SERVER=ws://<your-ip>:8080`. Players never get a LAN fallback.

## Operational notes

- Keep the public relay behind a process manager such as systemd, Docker Compose, or a hosted container service.
- Restrict the relay port so only the reverse proxy can reach it when Caddy runs on the same host.
- Use the existing pairing code and server-side slot validation as the first access boundary.
- Send authenticated durable match and telemetry writes to Tiger Data from the server, not directly from the phone.
