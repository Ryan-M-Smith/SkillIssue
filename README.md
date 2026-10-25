# Skill Issue

A 2v2 game where each team is one character driven by two phones held sideways like a controller: one phone moves, the other aims and shoots. Blue vs Red on one split screen. First to 10 kills, or whoever leads after 5 minutes.

## Run it

1. Open `apps/game` in Godot 4.7 and press **Run Project** (F5). The main menu opens. (F6, "Run Current Scene", skips the menu.)
2. **Create a Lobby**. The game hosts the server itself (nothing else to install) and shows a 6-character join code and the address phones connect to. Allow Godot through the firewall if your computer asks.
3. For the phone app, once: install Node.js 20+ and run `npm install` in this folder.
4. On each phone, open the companion app (`npm run companion:start`, then Expo Go): **Join a Lobby**, enter the code, pick a team and role, tap **Ready**. Set the server address under Settings if it isn't filled in.
5. When all four phones are ready the match counts down and starts. At the end: scores and stats, then **Play Again** or **Main Menu**.

Testing with fewer phones: run the game with `-- --min-players=1`. Keyboard controls also work in a match (see `apps/game/entities/duo/README.md`).

## Pieces

| Folder | What it is |
| --- | --- |
| `apps/game` | Godot game: menus, lobby, split-screen match, results |
| `apps/companion` | Expo app: the phone controller (movement or aim). Its web version is a motion debugger |
| `apps/server` | The same server in Node.js, for the web motion debugger or to run a server on its own. The game uses it if it's already running on port 8080 |
| `packages/protocol` | Message types shared by all three |
| `docs/network-protocol.md` | The protocol and the flow |
