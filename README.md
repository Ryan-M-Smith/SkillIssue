# Skill Issue

A 2v2 game where each team is one character driven by two phones held sideways like a controller: one phone moves, the other aims and shoots. Blue vs Red on one split screen. First to 10 kills, or whoever leads after 5 minutes.

Sign in with Google or GitHub (Auth0) on the phone, in the game and on the website: every match is saved to Tiger Data, and the website shows the live all-time leaderboard and your own stats.

## Run it

1. Open `apps/game` in Godot 4.7 and press **Run Project** (F5). The main menu opens. (F6, "Run Current Scene", skips the menu.)
2. **Sign In** (optional): Google or GitHub, in your browser. Signed in, the game saves every match it hosts to the leaderboard.
3. **Create a Lobby**. The game hosts the server itself (nothing else to install) and shows a 6-character join code and the address phones connect to. Allow Godot through the firewall if your computer asks.
4. For the phone app, once: install Node.js 20+ and run `npm install` in this folder.
5. On each phone, open the companion app (`npm run companion:start`, then Expo Go). Sign in (or play as a guest), **Join a Lobby**, enter the code, pick a team and role, tap **Ready**. Set the server address under Settings if it isn't filled in.
6. When all four phones are ready the match counts down and starts. At the end: scores and stats (saved to the leaderboard if the game is signed in), then **Play Again** or **Main Menu**.

Testing with fewer phones: run the game with `-- --min-players=1`. Keyboard controls also work in a match (see `apps/game/entities/duo/README.md`).

## Website, accounts and stats

```
npm run db:migrate   # create the tables in Tiger Cloud (DATABASE_URL in apps/api/.env)
npm run auth0:setup  # create the Auth0 API, apps and Google/GitHub logins
npm run web:build    # build the website
npm run api:start    # website + API on http://localhost:3000
```

Setup for Auth0, Tiger Data and the GoDaddy domain, step by step: [docs/mlh-setup.md](docs/mlh-setup.md).

## Pieces

| Folder | What it is |
| --- | --- |
| `apps/game` | Godot game: menus, sign-in, lobby, split-screen match, results, match upload |
| `apps/companion` | Expo app: the phone controller (movement or aim) with sign-in. Its web version is the website (landing page, live leaderboard, your stats); the motion debugger is at `/debug` |
| `apps/api` | Web API: Auth0 token checks, Tiger Data (TimescaleDB) accounts, matches, leaderboards; serves the website |
| `apps/server` | The game's lobby server in Node.js, for the web motion debugger or to run a server on its own. The game uses it if it's already running on port 8080 |
| `packages/protocol` | Message types shared by the game, phones and servers |
| `docs/network-protocol.md` | The lobby protocol and the flow |
| `docs/mlh-setup.md` | Auth0, Tiger Data, GoDaddy: setup and API reference |
