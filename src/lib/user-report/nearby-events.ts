import { getSupabaseServiceClient } from "@/lib/supabase";
import { distanceKm } from "@/lib/geo-utils";
import type { NearbyScanEvent } from "./types";

const TABLE_NAME = "scan_events";

export async function fetchNearbyScanEvents(params: {
    lat: number;
    lng: number;
    city?: string | null;
    radiusKm?: number;
    limit?: number;
}): Promise<NearbyScanEvent[]> {
    const radiusKm = params.radiusKm ?? 1;
    const limit = params.limit ?? 50;

    const supabase = getSupabaseServiceClient();
    let query = supabase
        .from(TABLE_NAME)
        .select("event_id, lat, lng, event_tags, ai_summary, category, city, area, is_user_submitted, updated_at")
        .not("lat", "is", null)
        .not("lng", "is", null)
        .order("updated_at", { ascending: false })
        .limit(500);

    if (params.city?.trim()) {
        query = query.ilike("city", params.city.trim());
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Supabase nearby query failed: ${error.message}`);
    }

    const rows = (data || []) as NearbyScanEvent[];
    return rows
        .map((row) => {
            const lat = Number(row.lat);
            const lng = Number(row.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const d = distanceKm(params.lat, params.lng, lat, lng);
            return { ...row, lat, lng, distance_km: Number(d.toFixed(4)) };
        })
        .filter((row): row is NearbyScanEvent => row !== null && (row.distance_km ?? Infinity) <= radiusKm)
        .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
        .slice(0, limit);
}
