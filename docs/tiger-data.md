# Tiger Data leaderboard

The landing app reads the leaderboard server-side from Tiger Cloud's Postgres-compatible endpoint. Set this Vercel environment variable:

```text
TIGER_DATABASE_URL=postgres://...
```

The browser only receives ranked rows from `/api/leaderboard`; the database URL never enters client code. The endpoint is polled every 15 seconds by the landing page and returns a no-store response.

The expected table is:

```sql
CREATE TABLE leaderboard_entries (
    player_id text PRIMARY KEY,
    display_name text NOT NULL,
    wins integer NOT NULL DEFAULT 0,
    losses integer NOT NULL DEFAULT 0,
    score integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

The server currently orders by `score DESC`, then wins, and limits the public board to ten entries. Match result ingestion should happen in the relay or a trusted server action, not from the browser.

If the environment variable or table is missing, `/api/leaderboard` returns a diagnostic response and the page shows a disconnected state rather than exposing database errors.
