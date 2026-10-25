import { NextResponse } from "next/server";

export function GET() {
    const websocketUrl = process.env.NEXT_PUBLIC_GAME_SERVER ?? process.env.GAME_SERVER_URL ?? "";
    const configured = websocketUrl.startsWith("wss://");

    return NextResponse.json({
        service: "skill-issue-control-plane",
        websocketUrl,
        gameProvisioningUrl: "/api/games",
        gameSocketPath: "/games/<gameId>",
        configured,
        transport: "websocket",
        tlsRequired: true,
        persistence: "tiger-data-via-relay",
    }, {
        headers: {
            "cache-control": "no-store",
        },
    });
}
