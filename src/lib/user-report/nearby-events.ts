import { getSupabaseServiceClient } from "@/lib/supabase";
import { distanceKm } from "@/lib/geo-utils";
import {
    fetchWithInsecureTls,
    getSupabaseRestConfig,
    logSupabaseTlsFallbackOnce,
    shouldUseSupabaseTlsFallback,
} from "@/lib/supabase-tls-fallback";
import type { NearbyScanEvent, ScoredNearbyEvent } from "./types";

const TABLE_NAME = "scan_events";

async function fetchNearbyViaSupabaseRest(params: {
    city?: string | null;
}): Promise<NearbyScanEvent[]> {
    const config = getSupabaseRestConfig();
    if (!config) {
        throw new Error("Supabase REST config missing");
    }

    const query = new URLSearchParams();
    query.set(
        "select",
        "event_id,lat,lng,area_lat,area_lng,event_tags,ai_summary,category,city,area,is_user_submitted,updated_at",
    );
    query.set("order", "updated_at.desc");
    query.set("limit", "500");
    if (params.city?.trim()) {
        query.set("city", `ilike.${params.city.trim()}`);
    }

    const endpoint = `${config.url}/rest/v1/${TABLE_NAME}?${query.toString()}`;
    const init: RequestInit = {
        method: "GET",
        headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
        },
    };

    let response: Response;
    try {
        response = await fetch(endpoint, init);
    } catch (error: any) {
        if (shouldUseSupabaseTlsFallback(error)) {
            logSupabaseTlsFallbackOnce("USER-REPORTS-NEARBY");
            response = await fetchWithInsecureTls(endpoint, init);
        } else {
            throw new Error(error?.message || "Supabase REST fetch failed");
        }
    }

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supabase REST nearby query failed (${response.status}): ${details}`);
    }

    return ((await response.json()) || []) as NearbyScanEvent[];
}

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
    let rows = (data || []) as NearbyScanEvent[];
    if (error) {
        if (!shouldUseSupabaseTlsFallback(error)) {
            throw new Error(`Supabase nearby query failed: ${error.message}`);
        }
        logSupabaseTlsFallbackOnce("USER-REPORTS-NEARBY");
        rows = await fetchNearbyViaSupabaseRest({ city: params.city });
    }

    return rows
        .map((row): ScoredNearbyEvent | null => {
            const lat = Number(row.area_lat);
            const lng = Number(row.area_lng);
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
