import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export async function POST() {
    const relayUrl = process.env.NEXT_PUBLIC_GAME_SERVER ?? process.env.GAME_SERVER_URL ?? "";
    if (!relayUrl.startsWith("wss://")) {
        return NextResponse.json({
            message: "The public WSS relay is not configured.",
        }, { status: 503, headers: { "cache-control": "no-store" } });
    }

    const gameId = randomUUID();
    return NextResponse.json({
        gameId,
        websocketUrl: `${relayUrl.replace(/\/$/, "")}/games/${gameId}`,
    }, {
        status: 201,
        headers: { "cache-control": "no-store" },
    });
}
