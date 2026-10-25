import pg from "pg";

import { config } from "./config.ts";
import type { Identity } from "./auth.ts";

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
	if (!config.databaseUrl) throw new Error("DATABASE_URL isn't set: add your Tiger Cloud connection string.");
	pool ??= new pg.Pool({
		connectionString: config.databaseUrl,
		max: 5,
		// Tiger Cloud requires TLS; local test databases don't use it.
		ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(config.databaseUrl) ? undefined : { rejectUnauthorized: false },
	});
	return pool;
}

export const dbEnabled = () => !!config.databaseUrl;

export async function upsertPlayer(who: Identity, fallbackName: string | null = null) {
	const name = (who.name ?? fallbackName ?? "Player").slice(0, 32);
	const { rows } = await db().query(
		`insert into players (id, display_name, avatar_url, provider)
		 values ($1, $2, $3, $4)
		 on conflict (id) do update set
		     display_name = excluded.display_name,
		     avatar_url = coalesce(excluded.avatar_url, players.avatar_url),
		     last_seen_at = now()
		 returning id, display_name, avatar_url, provider, created_at`,
		[who.sub, name, who.picture, who.provider]
	);
	return rows[0];
}

export const sorts = {
	wins: "wins",
	kills: "kills",
	matches: "matches",
	accuracy: "accuracy",
	kd: "kd",
	headshots: "headshots",
	distance: "distance_m",
} as const;
export type Sort = keyof typeof sorts;

/** Totals per player from the continuous aggregate, optionally since a time. */
const totalsSql = (where: string) => `
	select
		p.id as player_id, p.display_name, p.avatar_url, p.provider,
		sum(d.matches)::int as matches, sum(d.wins)::int as wins,
		sum(d.kills)::int as kills, sum(d.deaths)::int as deaths,
		sum(d.shots)::int as shots, sum(d.hits)::int as hits, sum(d.headshots)::int as headshots,
		round(sum(d.distance_m))::int as distance_m, sum(d.jumps)::int as jumps,
		sum(d.crouches)::int as crouches, round(sum(d.sprint_s))::int as sprint_s,
		round(coalesce(sum(d.hits)::numeric / nullif(sum(d.shots), 0), 0), 3)::float as accuracy,
		round(sum(d.kills)::numeric / greatest(sum(d.deaths), 1), 2)::float as kd
	from player_daily d
	join players p on p.id = d.player_id
	${where}
	group by p.id`;

export async function leaderboard(period: "all" | "week", sort: Sort, limit: number) {
	const since = period === "week" ? "where d.day >= now() - interval '7 days'" : "";
	const order = sorts[sort];
	const { rows } = await db().query(
		`select row_number() over (order by ${order} desc, wins desc, kills desc, display_name)::int as rank, t.*
		 from (${totalsSql(since)}) t
		 order by rank
		 limit $1`,
		[limit]
	);
	return rows;
}

export async function summary() {
	const client = db();
	const [totals, hourly, recent] = await Promise.all([
		client.query(`
			select
				(select count(*) from matches)::int as matches,
				(select count(*) from players)::int as players,
				(select coalesce(sum(blue_score + red_score), 0) from matches)::int as kills,
				(select count(*) from matches where ended_at > now() - interval '24 hours')::int as matches_today`),
		client.query(`
			select time_bucket(interval '1 hour', ended_at) as hour, count(*)::int as matches
			from matches where ended_at > now() - interval '24 hours'
			group by 1 order by 1`),
		recentMatches(null, 6),
	]);
	return { ...totals.rows[0], hourly: hourly.rows, recent };
}

/** Recent matches, with every player's name. `playerId` limits it to that player's. */
export async function recentMatches(playerId: string | null, limit: number) {
	const { rows } = await db().query(
		`select m.id, m.ended_at, m.reason, m.winning_team, m.blue_score, m.red_score, m.duration_s,
		        json_agg(json_build_object(
		            'name', coalesce(p.display_name, mp.guest_name, 'Guest'),
		            'avatar', p.avatar_url, 'teamId', mp.team_id, 'role', mp.role,
		            'signedIn', mp.player_id is not null,
		            'kills', mp.kills, 'shots', mp.shots, 'hits', mp.hits, 'distance', mp.distance_m
		        ) order by mp.team_id, mp.role desc) as players
		 from matches m
		 join match_players mp on mp.match_id = m.id and mp.ended_at = m.ended_at
		 left join players p on p.id = mp.player_id
		 where ($1::text is null or m.id in (
		     select match_id from match_players where player_id = $1 order by ended_at desc limit $2))
		 group by m.id, m.ended_at
		 order by m.ended_at desc
		 limit $2`,
		[playerId, limit]
	);
	return rows;
}

export async function playerStats(playerId: string) {
	const client = db();
	const [totals, rank, daily] = await Promise.all([
		client.query(`${totalsSql("where p.id = $1")}`, [playerId]),
		client.query(
			`select rank from (
			     select player_id, rank() over (order by wins desc, kills desc)::int as rank from leaderboard_all_time
			 ) r where player_id = $1`,
			[playerId]
		),
		client.query(
			`select day, matches::int, wins::int, kills::int from player_daily
			 where player_id = $1 and day > now() - interval '30 days' order by day`,
			[playerId]
		),
	]);
	return {
		totals: totals.rows[0] ?? null,
		rank: rank.rows[0]?.rank ?? null,
		daily: daily.rows,
		recent: await recentMatches(playerId, 10),
	};
}

export type MatchRow = {
	playerId: string | null;
	guestName: string | null;
	teamId: 1 | 2;
	role: "movement" | "aim";
	won: boolean;
	draw: boolean;
	kills: number;
	deaths: number;
	shots: number;
	hits: number;
	headshots: number;
	distance: number;
	jumps: number;
	crouches: number;
	sprint: number;
};

export async function saveMatch(match: {
	clientKey: string | null;
	hostId: string;
	lobbyCode: string | null;
	reason: string | null;
	winningTeam: 1 | 2 | null;
	scores: [number, number];
	durationS: number | null;
	rows: MatchRow[];
}) {
	const client = await db().connect();
	try {
		await client.query("begin");
		if (match.clientKey) {
			// The game retries uploads; the same match is saved once.
			const dupe = await client.query(
				"select id from matches where client_key = $1 and ended_at > now() - interval '1 day'",
				[match.clientKey]
			);
			if (dupe.rows[0]) {
				await client.query("rollback");
				return { id: dupe.rows[0].id as string, duplicate: true };
			}
		}
		const endedAt = new Date();
		const startedAt = match.durationS ? new Date(endedAt.getTime() - match.durationS * 1000) : null;
		const { rows } = await client.query(
			`insert into matches (ended_at, started_at, host_id, lobby_code, reason, winning_team, blue_score, red_score, duration_s, client_key)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
			[endedAt, startedAt, match.hostId, match.lobbyCode, match.reason, match.winningTeam, match.scores[0], match.scores[1], match.durationS, match.clientKey]
		);
		const id = rows[0].id as string;
		for (const r of match.rows) {
			await client.query(
				`insert into match_players (ended_at, match_id, player_id, guest_name, team_id, role, won, draw,
				     kills, deaths, shots, hits, headshots, distance_m, jumps, crouches, sprint_s)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
				[endedAt, id, r.playerId, r.guestName, r.teamId, r.role, r.won, r.draw,
					r.kills, r.deaths, r.shots, r.hits, r.headshots, r.distance, r.jumps, r.crouches, r.sprint]
			);
		}
		await client.query("commit");
		return { id, duplicate: false };
	} catch (e) {
		await client.query("rollback").catch(() => {});
		throw e;
	} finally {
		client.release();
	}
}
