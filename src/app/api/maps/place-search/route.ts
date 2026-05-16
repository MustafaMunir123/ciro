import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAPS_TLS_INSECURE_FALLBACK = process.env.MAPS_API_TLS_INSECURE_FALLBACK === "true";

function getErrorCode(error: any): string | undefined {
    return error?.code || error?.cause?.code;
}

async function fetchWithInsecureTls(url: string): Promise<Response> {
    const https = await import("https");
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: "GET", rejectUnauthorized: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => {
                const responseBody = Buffer.concat(chunks);
                resolve(
                    new Response(responseBody, {
                        status: res.statusCode || 500,
                        headers: res.headers as Record<string, string>,
                    })
                );
            });
        });
        req.on("error", reject);
        req.end();
    });
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = (searchParams.get("query") || "").trim();
        if (!query) {
            return NextResponse.json({ error: "Missing required query parameter: query" }, { status: 400 });
        }

        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "Missing Google Maps API key" }, { status: 500 });
        }

        const endpoint = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;

        let response: Response;
        try {
            response = await fetch(endpoint, { cache: "no-store" });
        } catch (error: any) {
            if (MAPS_TLS_INSECURE_FALLBACK && getErrorCode(error) === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
                response = await fetchWithInsecureTls(endpoint);
            } else {
                throw error;
            }
        }

        if (!response.ok) {
            return NextResponse.json({ error: `Google Places request failed (${response.status})` }, { status: 502 });
        }

        const json = await response.json();
        const first = Array.isArray(json?.results) ? json.results[0] : null;
        if (!first?.geometry?.location) {
            return NextResponse.json({ error: "No place match found", status: json?.status || "ZERO_RESULTS" }, { status: 404 });
        }

        return NextResponse.json({
            query,
            place_name: first?.name || query,
            formatted_address: first?.formatted_address || query,
            lat: first.geometry.location.lat,
            lng: first.geometry.location.lng,
            place_id: first?.place_id || null,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Place search failed" }, { status: 500 });
    }
}
