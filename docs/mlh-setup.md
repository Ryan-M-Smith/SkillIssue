# Accounts, stats and the website (Auth0 · Tiger Data · GoDaddy)

SkillIssue has three online pieces, all in this repo:

| Piece | Where | What it does |
| --- | --- | --- |
| Web API | `apps/api` | Checks Auth0 sign-ins, stores accounts, matches and stats in Tiger Data, serves leaderboards. Also serves the website. |
| Website | `apps/companion` (web build) | Landing page for demos, the live leaderboard, sign-in and your own stats. The motion debugger is at `/debug`. |
| Sign-in screens | phone app, Godot game | Sign in with Google or GitHub. A signed-in game uploads every match; each signed-in phone's stats go to its owner's account. |

```
 phone app ──(join_game + Auth0 token)──▶ Godot game (hosts the lobby)
                                              │ match over: POST /api/matches
                                              │ (game's token + each phone's token)
 website ◀──── /api/leaderboard, /api/me ──── apps/api ──▶ Tiger Cloud (TimescaleDB)
     └──── sign in (Auth0: Google / GitHub) ─────┘
```

Only the API holds secrets (the database URL). The website, phone app and game get
the public Auth0 settings from `GET /api/config`, so they only need to know the
website's address.

## 1. Tiger Data (the database)

1. Sign up at [console.cloud.timescale.com](https://console.cloud.timescale.com) and create a service (the free tier is enough).
2. Copy the service's connection string (`postgres://tsdbadmin:…@….tsdb.cloud.timescale.com:…/tsdb?sslmode=require`).
3. Put it in `apps/api/.env`:

   ```
   DATABASE_URL=postgres://tsdbadmin:...@....tsdb.cloud.timescale.com:31234/tsdb?sslmode=require
   ```

4. Create the tables: `npm run db:migrate`. It prints the hypertables it made.

What the schema uses (`apps/api/db/schema.sql`):

- `players`: one row per account (the Auth0 user id, name, picture, Google or GitHub).
- `matches` and `match_players`: **hypertables** partitioned by `ended_at`. Every match, and every phone's line in it (team, role, won, kills, shots, hits, distance, …).
- `player_daily`: a **real-time continuous aggregate**: per player per day, refreshed by a policy every 30 minutes and live for the newest rows, so a match shows up the moment it's saved.
- `leaderboard_all_time`: a view of every player's career totals over `player_daily`.
- A **compression policy** on `match_players` after 30 days (segmented by player).

The website's weekly board and activity chart query the same aggregate with `time_bucket`.

## 2. Auth0 (sign in with Google and GitHub)

1. Sign up at [auth0.com](https://auth0.com) and create a tenant. Note its domain (`your-tenant.us.auth0.com`).
2. Get a Management API token: Dashboard → **Applications → APIs → Auth0 Management API → API Explorer** → copy the token.
3. Run the setup script:

   ```
   AUTH0_DOMAIN=your-tenant.us.auth0.com AUTH0_MGMT_TOKEN=eyJ... SITE_URL=https://your-domain npm run auth0:setup
   ```

   It creates, or updates if they exist:
   - the **SkillIssue API** (audience `https://api.skillissue.game`, refresh tokens on),
   - **SkillIssue Web**, a single-page app for the website (callback `https://your-domain/auth`, plus localhost for development),
   - **SkillIssue Native**, a native app for the phone app (`companion://auth`) and the Godot game (`http://127.0.0.1:7350/callback`),
   - the **Google** and **GitHub** logins, switched on for both apps,

   and writes `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_WEB_CLIENT_ID` and `AUTH0_NATIVE_CLIENT_ID` to `apps/api/.env`.
4. Without your own OAuth keys, Auth0 uses its development keys for Google and GitHub. That's fine for a demo. For launch, create a GitHub OAuth app and a Google OAuth client, then run the script again with `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. The callback URL for both is `https://your-tenant.us.auth0.com/login/callback`.
5. **Expo Go:** the phone app's callback is `exp://<computer-ip>:8081/--/auth`, which depends on your computer. The app shows its own under **Sign in → Website address**. Add it to *SkillIssue Native → Allowed Callback URLs*, or run the script with `EXTRA_NATIVE_CALLBACKS=exp://192.168.1.20:8081/--/auth`.

## 3. Run it locally

```
npm install
npm run db:migrate
npm run web:build      # builds the website into apps/companion/dist
npm run api:start      # http://localhost:3000: website + API
```

- **Website:** open http://localhost:3000. For live-reload work on the page, run `npm run companion:web` (it talks to the API on port 3000).
- **Game:** it uses `http://127.0.0.1:3000` by default. Change it in Project Settings → `skillissue/api_url`, or run with `-- --api=https://your-domain`.
- **Phone app:** it guesses the API from the Expo dev server's computer. Otherwise set **Sign in → Website address**.

## 4. GoDaddy Registry (the domain) and hosting

1. Claim the domain: go to [mlh.link/godaddyregistry](https://mlh.link/godaddyregistry), pick a name and use code **MLHHPS2676** at checkout.
2. Host the site. The API is a plain Node.js app (Node 20+) that also serves the website, so it's one deploy:
   - **GoDaddy hosting with Node.js** (cPanel → *Setup Node.js App*): application root = this repo, startup file `apps/api/start.mjs`, then add the environment variables from `apps/api/.env`. Run `npm install` and `npm run web:build` from the cPanel terminal (or upload `apps/companion/dist`).
   - **Or any Node host** (Render, Railway, Fly): build command `npm install && npm run web:build`, start command `npm run api:start`, same environment variables. Then in GoDaddy DNS, point the domain at it (a `CNAME` for `www`, plus the host's `A` record or forwarding for the root).
3. Run `npm run auth0:setup` once more with `SITE_URL=https://your-domain`, so Auth0 accepts sign-ins from the live site.
4. Point the game at the live site (`skillissue/api_url`) and you're done: matches played anywhere show up on the website's leaderboard.

## API reference

| Route | Auth | Returns |
| --- | --- | --- |
| `GET /api/config` | none | Auth0 domain, issuer, audience, client ids, connections |
| `GET /api/health` | none | `{ok, db, auth}` |
| `GET /api/leaderboard?period=all\|week&sort=wins\|kills\|accuracy\|kd\|distance\|matches&limit=25` | none | ranked players |
| `GET /api/summary` | none | totals, matches per hour (last 24 h), recent matches |
| `GET /api/me` | player token | profile, career totals, rank, last 30 days, recent matches |
| `POST /api/matches` | game token | saves a finished match (sent by the game) |

**Who gets credit.** The game signs the upload with its own token and includes the token each phone joined with. The API checks every token on its own. Phones with a valid token count toward their accounts; everyone else is saved as a guest. The duo shares kills, deaths and the result. Shots, hits and headshots go to the aim phone, and distance, jumps, crouches and sprinting to the movement phone.

**Privacy.** A phone's token travels to the game over the local network and only ever goes to the game, never to the other phones. Tokens last 24 hours, and the API only reads the account id, name and picture from them.
