import { NextRequest, NextResponse } from "next/server";
import { fetchNearbyScanEvents } from "@/lib/user-report/nearby-events";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const lat = Number(searchParams.get("lat"));
        const lng = Number(searchParams.get("lng"));
        const city = (searchParams.get("city") || "").trim() || null;
        const radiusKm = Number(searchParams.get("radius_km") || 1);
        const limit = Number(searchParams.get("limit") || 50);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return NextResponse.json({ error: "Missing or invalid lat/lng query params" }, { status: 400 });
        }

        const safeRadius = Number.isFinite(radiusKm) ? Math.max(0.1, Math.min(50, radiusKm)) : 1;
        const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50;

        const events = await fetchNearbyScanEvents({
            lat,
            lng,
            city,
            radiusKm: safeRadius,
            limit: safeLimit,
        });

        return NextResponse.json({
            count: events.length,
            radius_km: safeRadius,
            events,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch nearby events";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
