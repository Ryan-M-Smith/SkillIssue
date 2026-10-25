-- SkillIssue on Tiger Data (TimescaleDB / Tiger Cloud).
-- Accounts, every finished match, every player's line in every match, and the
-- leaderboards built from them. Safe to run more than once (npm run db:migrate).

create extension if not exists timescaledb;

-- One row per signed-in person. `id` is the Auth0 user id (the token's `sub`),
-- e.g. "google-oauth2|1234" or "github|5678".
create table if not exists players (
    id            text primary key,
    display_name  text        not null,
    avatar_url    text,
    provider      text,                       -- google-oauth2 | github
    created_at    timestamptz not null default now(),
    last_seen_at  timestamptz not null default now()
);

-- One row per finished match. A hypertable on ended_at: matches arrive in time
-- order and every leaderboard query is a time range.
create table if not exists matches (
    id            uuid        not null default gen_random_uuid(),
    ended_at      timestamptz not null,
    started_at    timestamptz,
    host_id       text        references players (id),
    lobby_code    text,
    reason        text,                       -- kills | time
    winning_team  smallint,                   -- 1 blue, 2 red, null = draw
    blue_score    integer     not null default 0,
    red_score     integer     not null default 0,
    duration_s    integer,
    primary key (id, ended_at)
);
select create_hypertable('matches', by_range('ended_at', interval '7 days'), if_not_exists => true);
-- A random id the game picks per match, so a retried upload isn't saved twice.
alter table matches add column if not exists client_key text;
create index if not exists matches_client_key on matches (client_key, ended_at desc);

-- One row per phone per match. Kills, deaths and the result belong to the duo
-- (both phones). Shots, hits and headshots go to the aim phone; distance, jumps,
-- crouches and sprinting to the movement phone. Guests have no player_id.
create table if not exists match_players (
    ended_at        timestamptz not null,
    match_id        uuid        not null,
    player_id       text        references players (id),
    guest_name      text,
    team_id         smallint    not null,     -- 1 blue, 2 red
    role            text        not null,     -- movement | aim
    won             boolean     not null,
    draw            boolean     not null default false,
    kills           integer     not null default 0,
    deaths          integer     not null default 0,
    shots           integer     not null default 0,
    hits            integer     not null default 0,
    headshots       integer     not null default 0,
    distance_m      real        not null default 0,
    jumps           integer     not null default 0,
    crouches        integer     not null default 0,
    sprint_s        real        not null default 0
);
select create_hypertable('match_players', by_range('ended_at', interval '7 days'), if_not_exists => true);
create index if not exists match_players_player_time on match_players (player_id, ended_at desc);
create index if not exists match_players_match on match_players (match_id);

-- Per player per day, kept up to date by TimescaleDB. Real-time
-- (materialized_only = false), so a match shows up the moment it's saved.
create materialized view if not exists player_daily
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select
    time_bucket(interval '1 day', ended_at) as day,
    player_id,
    count(*)                                as matches,
    count(*) filter (where won)             as wins,
    sum(kills)                              as kills,
    sum(deaths)                             as deaths,
    sum(shots)                              as shots,
    sum(hits)                               as hits,
    sum(headshots)                          as headshots,
    sum(distance_m)                         as distance_m,
    sum(jumps)                              as jumps,
    sum(crouches)                           as crouches,
    sum(sprint_s)                           as sprint_s
from match_players
where player_id is not null
group by 1, 2
with no data;

do $$
begin
    perform add_continuous_aggregate_policy('player_daily',
        start_offset      => interval '3 days',
        end_offset        => interval '1 hour',
        schedule_interval => interval '30 minutes');
exception when others then
    null; -- the policy already exists
end $$;

-- Old raw rows compress well and the leaderboards read the aggregate anyway.
do $$
begin
    alter table match_players set (timescaledb.compress, timescaledb.compress_segmentby = 'player_id');
    perform add_compression_policy('match_players', interval '30 days');
exception when others then
    null; -- already set up
end $$;

-- All-time leaderboard: every signed-in player's career totals.
create or replace view leaderboard_all_time as
select
    p.id                                        as player_id,
    p.display_name,
    p.avatar_url,
    p.provider,
    sum(d.matches)::int                         as matches,
    sum(d.wins)::int                            as wins,
    sum(d.kills)::int                           as kills,
    sum(d.deaths)::int                          as deaths,
    sum(d.shots)::int                           as shots,
    sum(d.hits)::int                            as hits,
    sum(d.headshots)::int                       as headshots,
    round(sum(d.distance_m))::int               as distance_m,
    sum(d.jumps)::int                           as jumps,
    sum(d.crouches)::int                        as crouches,
    round(sum(d.sprint_s))::int                 as sprint_s
from player_daily d
join players p on p.id = d.player_id
group by p.id;
