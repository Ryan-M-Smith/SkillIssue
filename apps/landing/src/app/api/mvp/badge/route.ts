/**
 * POST /api/mvp/badge: Gemini draws the picture for the results screen's MVP card.
 *   {"kind": "mvp", "role": "gunner" | "runner", "team": "blue" | "red", "headline", "reason"}
 *     → a raccoon badge (square) made for that accolade
 *   {"kind": "none"}
 *     → no MVP: tumbleweeds and a sly black-and-white noir raccoon lurking (wide)
 * Replies with the image bytes (image/png or image/jpeg). The game starts this right after
 * the MVP is picked at the final whistle and draws its own stand-in if this fails.
 * Env: GEMINI_API_KEY (required), GEMINI_IMAGE_MODEL (default gemini-3.1-flash-image,
 * falling back to gemini-2.5-flash-image).
 */

export const maxDuration = 60;

type Badge =
    | { kind: "mvp"; role: "gunner" | "runner"; team: "blue" | "red"; headline: string; reason: string }
    | { kind: "none" };

type Picture = { bytes: Uint8Array; type: string; at: number };

const noStore = { "cache-control": "no-store" };
const fallbackModel = "gemini-2.5-flash-image";

// Small per-instance memory: the no-MVP scene is reused, and an identical accolade too.
const cache = new Map<string, Picture>();
const cacheMs = 60 * 60 * 1000;
const recent = new Map<string, number[]>();
const perMinute = 6;

const style = "Film-noir style: black and white, deep shadows, hard rim light, rain, wet reflections, " +
    "subtle film grain, 1940s detective mood. No text, no letters, no numbers, no logos, no watermark.";

function prompt(badge: Badge): string {
    if (badge.kind === "none") {
        return "Wide cinematic shot of an empty, rain-slicked city alley at night. Two or three dry " +
            "tumbleweeds roll across the wet cobblestones. In a dark doorway, a sly raccoon lurks in the " +
            "shadows: only its bandit mask, a knowing smirk and glinting eyes catch the light. Nobody won " +
            "here, and the raccoon knows it. Strictly black and white. " + style;
    }
    const accent = badge.team === "red" ? "deep red" : "electric blue";
    const pose = badge.role === "gunner"
        ? "a raccoon gunslinger in a trench coat and fedora, steady-eyed behind a vintage revolver or a scoped rifle"
        : "a raccoon runner in a trench coat and fedora, mid-sprint, coat flaring, kicking up rain, impossible to pin down";
    return `A circular medallion badge, like an enamel award pin, filling a square canvas on a plain black background. ` +
        `Inside the medallion: ${pose}. It celebrates the accolade "${badge.headline}": ${badge.reason} ` +
        `Make the scene show that achievement. Black and white, with ${accent} as the only color, on the medallion's rim ` +
        `and a few highlights. Bold, iconic, readable at small size. ` + style;
}

function clean(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    // Plain words only: it goes into a prompt.
    const text = value.replace(/[\u0000-\u001f"`\\<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
    return text || null;
}

function parse(body: unknown): Badge | null {
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;
    if (b.kind === "none") return { kind: "none" };
    if (b.kind !== "mvp") return null;
    if (b.role !== "gunner" && b.role !== "runner") return null;
    if (b.team !== "blue" && b.team !== "red") return null;
    const headline = clean(b.headline, 40);
    const reason = clean(b.reason, 220) ?? "";
    if (!headline) return null;
    return { kind: "mvp", role: b.role, team: b.team, headline, reason };
}

function limited(ip: string): boolean {
    const now = Date.now();
    const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
    hits.push(now);
    recent.set(ip, hits);
    if (recent.size > 5000) recent.clear();
    return hits.length > perMinute;
}

function reply(picture: Picture) {
    return new Response(Buffer.from(picture.bytes), { headers: { "content-type": picture.type, "cache-control": "no-store" } });
}

async function draw(model: string, apiKey: string, badge: Badge): Promise<Picture | number> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt(badge) }] }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: badge.kind === "none" ? "16:9" : "1:1" },
            },
        }),
        signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return response.status;
    const data = await response.json();
    const parts: { inlineData?: { mimeType?: string; data?: string } }[] = data?.candidates?.[0]?.content?.parts ?? [];
    const image = parts.find((p) => p.inlineData?.data && /^image\/(png|jpeg|webp)$/.test(p.inlineData.mimeType ?? ""));
    if (!image?.inlineData?.data) return 502;
    return { bytes: Uint8Array.from(Buffer.from(image.inlineData.data, "base64")), type: image.inlineData.mimeType!, at: Date.now() };
}

export async function POST(request: Request) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return Response.json({ message: "GEMINI_API_KEY is not configured." }, { status: 503, headers: noStore });
    const text = await request.text();
    if (text.length > 2048) return Response.json({ message: "Request too large." }, { status: 413, headers: noStore });
    let badge: Badge | null = null;
    try {
        badge = parse(JSON.parse(text));
    } catch {
        badge = null;
    }
    if (!badge) return Response.json({ message: "Invalid badge request." }, { status: 400, headers: noStore });

    const key = JSON.stringify(badge);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < cacheMs) return reply(cached);

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (limited(ip)) return Response.json({ message: "Too many badge requests. Try again in a minute." }, { status: 429, headers: noStore });

    const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
    try {
        let picture = await draw(model, apiKey, badge);
        if (picture === 404 && model !== fallbackModel) picture = await draw(fallbackModel, apiKey, badge);
        if (typeof picture === "number") {
            return Response.json({ message: `Gemini answered ${picture}.` }, { status: 502, headers: noStore });
        }
        if (cache.size >= 24) cache.delete(cache.keys().next().value!);
        cache.set(key, picture);
        return reply(picture);
    } catch (error) {
        return Response.json({ message: `Gemini request failed: ${(error as Error).message}` }, { status: 502, headers: noStore });
    }
}
