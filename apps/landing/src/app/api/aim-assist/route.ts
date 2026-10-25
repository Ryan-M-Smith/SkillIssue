import { NextResponse } from "next/server";

type Target = {
    id: string;
    x: number;
    y: number;
    visible: boolean;
    distance: number;
    health: number;
};

type AimRequest = {
    crosshair?: { x?: number; y?: number };
    targets?: Target[];
};

const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const apiKey = process.env.GEMINI_API_KEY;

function number(value: unknown, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: Request) {
    if (!apiKey) {
        return NextResponse.json({ dxDegreesPerSecond: 0, dyDegreesPerSecond: 0, confidence: 0, targetId: null, reason: "unconfigured" }, { status: 503 });
    }

    let input: AimRequest;
    try {
        input = await request.json() as AimRequest;
    } catch {
        return NextResponse.json({ message: "Invalid aim state." }, { status: 400 });
    }

    const targets = Array.isArray(input.targets) ? input.targets.slice(0, 8).map(target => ({
        id: String(target.id ?? "unknown").slice(0, 64),
        x: Math.max(0, Math.min(1, number(target.x, 0.5))),
        y: Math.max(0, Math.min(1, number(target.y, 0.5))),
        visible: target.visible === true,
        distance: Math.max(0, number(target.distance)),
        health: Math.max(0, number(target.health)),
    })) : [];
    const crosshair = {
        x: Math.max(0, Math.min(1, number(input.crosshair?.x, 0.5))),
        y: Math.max(0, Math.min(1, number(input.crosshair?.y, 0.5))),
    };

    const prompt = [
        "You are a low-latency game aim-assist selector.",
        "Choose the best visible target and return only JSON.",
        "Do not invent targets. Prefer visible, alive, closer targets; return zero correction when none are visible.",
        "dxDegreesPerSecond and dyDegreesPerSecond must be bounded between -12 and 12.",
        JSON.stringify({ crosshair, targets }),
    ].join("\n");

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0,
                    maxOutputTokens: 160,
                },
            }),
        });
        if (!response.ok) return NextResponse.json({ dxDegreesPerSecond: 0, dyDegreesPerSecond: 0, confidence: 0, targetId: null, reason: "model_unavailable" }, { status: 502 });
        const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        const result = JSON.parse(text) as Record<string, unknown>;
        return NextResponse.json({
            dxDegreesPerSecond: Math.max(-12, Math.min(12, number(result.dxDegreesPerSecond))),
            dyDegreesPerSecond: Math.max(-12, Math.min(12, number(result.dyDegreesPerSecond))),
            confidence: Math.max(0, Math.min(1, number(result.confidence))),
            targetId: typeof result.targetId === "string" ? result.targetId.slice(0, 64) : null,
        }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        console.error("aim assist request failed", error);
        return NextResponse.json({ dxDegreesPerSecond: 0, dyDegreesPerSecond: 0, confidence: 0, targetId: null, reason: "invalid_model_response" }, { status: 502 });
    }
}
