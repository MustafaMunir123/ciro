import { NextRequest, NextResponse } from "next/server";
import { fetchCurrentWeather } from "@/lib/weather-layer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const lat = Number(searchParams.get("lat"));
        const lng = Number(searchParams.get("lng"));

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return NextResponse.json(
                { error: "Missing or invalid lat/lng query params" },
                { status: 400 },
            );
        }

        const data = await fetchCurrentWeather(lat, lng);
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to fetch current weather" },
            { status: 500 },
        );
    }
}
