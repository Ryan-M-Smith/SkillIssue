import { NextResponse } from "next/server";
import postgres from "postgres";

type LeaderboardEntry = {
    playerId: string;
    displayName: string;
    wins: number;
    losses: number;
    score: number;
    updatedAt: string;
};

const connectionString = process.env.TIGER_DATABASE_URL ?? process.env.DATABASE_URL;
const sql = connectionString
    ? postgres(connectionString, { max: 1, prepare: false, connect_timeout: 10 })
    : null;

export async function GET() {
    if (!sql) {
        return NextResponse.json({
            entries: [],
            source: "unconfigured",
            message: "Set TIGER_DATABASE_URL in the Vercel environment.",
        }, { status: 503, headers: { "cache-control": "no-store" } });
    }

    try {
        const entries = await sql<LeaderboardEntry[]>`
            SELECT
                player_id AS "playerId",
                display_name AS "displayName",
                wins,
                losses,
                score,
                updated_at AS "updatedAt"
            FROM leaderboard_entries
            ORDER BY score DESC, wins DESC, updated_at ASC
            LIMIT 10
        `;

        return NextResponse.json({
            entries,
            source: "tiger-data",
            updatedAt: new Date().toISOString(),
        }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        console.error("leaderboard query failed", error);
        return NextResponse.json({
            entries: [],
            source: "error",
            message: "The leaderboard is temporarily unavailable.",
        }, { status: 502, headers: { "cache-control": "no-store" } });
    }
}
