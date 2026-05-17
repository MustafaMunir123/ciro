import { getSupabaseServiceClient } from "@/lib/supabase";
import { distanceKm } from "@/lib/geo-utils";
import type { NearbyScanEvent, ScoredNearbyEvent } from "./types";

const TABLE_NAME = "scan_events";

export async function fetchNearbyScanEvents(params: {
    lat: number;
    lng: number;
    city?: string | null;
    radiusKm?: number;
    limit?: number;
}): Promise<ScoredNearbyEvent[]> {
    const radiusKm = params.radiusKm ?? 1;
    const limit = params.limit ?? 50;

    const supabase = getSupabaseServiceClient();
    let query = supabase
        .from(TABLE_NAME)
        .select(
            "event_id, lat, lng, area_lat, area_lng, event_tags, ai_summary, category, city, area, is_user_submitted, updated_at",
        )
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
        .map((row): ScoredNearbyEvent | null => {
            const lat = Number(row.lat ?? row.area_lat);
            const lng = Number(row.lng ?? row.area_lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const d = distanceKm(params.lat, params.lng, lat, lng);
            return {
                ...row,
                lat,
                lng,
                distance_km: Number(d.toFixed(4)),
            };
        })
        .filter((row): row is ScoredNearbyEvent => row !== null && row.distance_km <= radiusKm)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, limit);
}
