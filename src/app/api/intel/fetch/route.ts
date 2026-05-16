import { NextRequest, NextResponse } from "next/server";
import { fetchDisasterIntel } from "@/lib/data-fetching-layer";

export const runtime = "nodejs";

interface IntelFetchPayload {
    query: string;
    city: string;
    area: string;
    topic?: string;
    limit?: number;
    language?: string;
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as IntelFetchPayload;

        if (!body.query || !body.city || !body.area) {
            return NextResponse.json(
                { error: "Missing required fields: query, city, area" },
                { status: 400 },
            );
        }

        const data = await fetchDisasterIntel({
            query: body.query,
            city: body.city,
            area: body.area,
            topic: body.topic,
            limit: body.limit,
            language: body.language,
        });

        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Intel fetch failed" },
            { status: 500 },
        );
    }
}
