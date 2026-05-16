import { NextRequest, NextResponse } from "next/server";
import { fetchForecastWeather } from "@/lib/weather-layer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const lat = Number(searchParams.get("lat"));
        const lng = Number(searchParams.get("lng"));
        const days = Number(searchParams.get("days") || 3);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return NextResponse.json(
                { error: "Missing or invalid lat/lng query params" },
                { status: 400 },
            );
        }

        const data = await fetchForecastWeather(lat, lng, days);
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to fetch forecast weather" },
            { status: 500 },
        );
    }
}
