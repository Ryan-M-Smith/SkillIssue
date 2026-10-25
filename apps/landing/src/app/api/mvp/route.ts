import { NextResponse } from "next/server";

/**
 * POST /api/mvp: the game sends a finished match (scores, how it ended, and each of the four
 * players' numbers) and Gemini picks the MVP. The Gemini key stays here on the server.
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-flash-latest).
 * The game falls back to its own rule when this fails, so errors just say why.
 */

export const maxDuration = 30;

type Player = {
    id: string;
    team: "blue" | "red";
    role: "gunner" | "runner";
    name: string;
    stats: Record<string, number>;
};

type MatchReport = {
    winner: "blue" | "red" | "draw";
    scores: { blue: number; red: number };
    endReason: string;
    durationSeconds: number;
    players: Player[];
};

const noStore = { "cache-control": "no-store" };
const maxBodyBytes = 8 * 1024;

// A small per-instance limit so the endpoint can't be used to burn the Gemini quota.
const recent = new Map<string, number[]>();
const perMinute = 10;

const instructions = `You pick the MVP of one match of Skill Issue, a 2v2 split-screen shooter.
Each team is ONE character driven by two phones: the Gunner aims and shoots, the Runner moves
the body (walk, sprint, jump, crouch). Both players on a team share its deaths.
Any of the four players can be MVP:
- A Gunner usually earns it with an outstanding game: a high KDR, many kills or high damage dealt,
  good accuracy, headshots, streaks.
- A Runner can earn it with a huge distance total or by being so shifty that the other team got
  very few kills, shot poorly (low enemy accuracy) or dealt little damage.
Judge the whole match, compare the players against each other and against the match length,
and favor the winning team when performances are close.
If the match is a DRAW, the bar is much higher: only name an MVP whose performance clearly
stood above all three other players; otherwise answer with mvp "none".
Answer with the player's id, a short punchy headline (2-4 words, no player name) and a
one-sentence reason (max 25 words) that cites their actual numbers.`;

const answerSchema = (ids: string[], allowNone: boolean) => ({
    type: "object",
    properties: {
        mvp: { type: "string", enum: allowNone ? [...ids, "none"] : ids },
        headline: { type: "string" },
        reason: { type: "string" },
    },
    required: ["mvp", "headline", "reason"],
});

function isNumberRecord(value: unknown): value is Record<string, number> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        && Object.keys(value).length <= 16
        && Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v));
}

function parseReport(body: unknown): MatchReport | null {
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;
    if (b.winner !== "blue" && b.winner !== "red" && b.winner !== "draw") return null;
    const scores = b.scores as Record<string, unknown> | undefined;
    if (!scores || typeof scores.blue !== "number" || typeof scores.red !== "number") return null;
    if (!Array.isArray(b.players) || b.players.length !== 4) return null;
    const players: Player[] = [];
    for (const raw of b.players) {
        const p = raw as Record<string, unknown>;
        if (typeof p.id !== "string" || !/^(blue|red)-(gunner|runner)$/.test(p.id)) return null;
        if (p.team !== "blue" && p.team !== "red") return null;
        if (p.role !== "gunner" && p.role !== "runner") return null;
        if (typeof p.name !== "string" || !isNumberRecord(p.stats)) return null;
        players.push({ id: p.id, team: p.team, role: p.role, name: p.name.slice(0, 24), stats: p.stats });
    }
    if (new Set(players.map((p) => p.id)).size !== 4) return null;
    return {
        winner: b.winner,
        scores: { blue: scores.blue, red: scores.red },
        endReason: typeof b.endReason === "string" ? b.endReason.slice(0, 16) : "",
        durationSeconds: typeof b.durationSeconds === "number" ? b.durationSeconds : 0,
        players,
    };
}

function limited(ip: string): boolean {
    const now = Date.now();
    const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
    hits.push(now);
    recent.set(ip, hits);
    if (recent.size > 5000) recent.clear();
    return hits.length > perMinute;
}

export async function POST(request: Request) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ message: "GEMINI_API_KEY is not configured." }, { status: 503, headers: noStore });
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (limited(ip)) {
        return NextResponse.json({ message: "Too many MVP requests. Try again in a minute." }, { status: 429, headers: noStore });
    }
    const text = await request.text();
    if (text.length > maxBodyBytes) {
        return NextResponse.json({ message: "Match report too large." }, { status: 413, headers: noStore });
    }
    let report: MatchReport | null = null;
    try {
        report = parseReport(JSON.parse(text));
    } catch {
        report = null;
    }
    if (!report) {
        return NextResponse.json({ message: "Invalid match report." }, { status: 400, headers: noStore });
    }

    const ids = report.players.map((p) => p.id);
    const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
    let reply: Response;
    try {
        reply = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: instructions }] },
                contents: [{ role: "user", parts: [{ text: `Match report (JSON):\n${JSON.stringify(report)}` }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseJsonSchema: answerSchema(ids, report.winner === "draw"),
                    temperature: 0.4,
                },
            }),
            signal: AbortSignal.timeout(20_000),
        });
    } catch (error) {
        return NextResponse.json({ message: `Gemini request failed: ${(error as Error).message}` }, { status: 502, headers: noStore });
    }
    if (!reply.ok) {
        return NextResponse.json({ message: `Gemini answered ${reply.status}.` }, { status: 502, headers: noStore });
    }

    try {
        const data = await reply.json();
        const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? [];
        const answer = JSON.parse(parts.map((p) => p.text ?? "").join(""));
        const mvp = answer.mvp === "none" && report.winner === "draw" ? "" : String(answer.mvp);
        if (mvp && !ids.includes(mvp)) throw new Error("unknown player");
        return NextResponse.json({
            mvp,
            headline: String(answer.headline ?? "").slice(0, 40),
            reason: String(answer.reason ?? "").slice(0, 220),
            model,
        }, { headers: noStore });
    } catch {
        return NextResponse.json({ message: "Gemini sent an unusable answer." }, { status: 502, headers: noStore });
    }
}
