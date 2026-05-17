import { getSupabaseServiceClient } from "@/lib/supabase";
import {
    fetchWithInsecureTls,
    getSupabaseRestConfig,
    logSupabaseTlsFallbackOnce,
    shouldUseSupabaseTlsFallback,
} from "@/lib/supabase-tls-fallback";
import type { Incident } from "@/lib/types";
import type { ParsedUserSubmission, UserSubmissionTopicPayload } from "./types";

const TABLE_NAME = "scan_events";

async function upsertUserScanEventViaSupabaseRest(payload: Record<string, unknown>): Promise<{ event_id: string; updated_at: string }> {
    const config = getSupabaseRestConfig();
    if (!config) {
        throw new Error("Supabase REST config missing");
    }

    const endpoint = `${config.url}/rest/v1/${TABLE_NAME}?on_conflict=event_id`;
    const init: RequestInit = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
            Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(payload),
    };

    let response: Response;
    try {
        response = await fetch(endpoint, init);
    } catch (error: any) {
        if (shouldUseSupabaseTlsFallback(error)) {
            logSupabaseTlsFallbackOnce("USER-REPORTS-UPSERT");
            response = await fetchWithInsecureTls(endpoint, init);
        } else {
            throw new Error(error?.message || "Supabase REST upsert failed");
        }
    }

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Supabase REST upsert failed (${response.status}): ${details}`);
    }

    const json = (await response.json()) as Array<{ event_id: string; updated_at: string }>;
    if (!Array.isArray(json) || json.length === 0) {
        throw new Error("Supabase REST upsert returned empty response");
    }
    return json[0];
}

function buildEventId(): string {
    const suffix =
        typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID().toUpperCase()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    return `EVT-USER-${suffix}`;
}

export function buildUserIncident(input: {
    eventId: string;
    parsed: ParsedUserSubmission;
    text: string;
    lat: number;
    lng: number;
    topicPayload: UserSubmissionTopicPayload;
    thumbnailPath?: string;
    address?: string;
}): Incident {
    const now = new Date().toISOString();
    const address = input.address || `${input.parsed.place}, ${input.parsed.area}, ${input.parsed.city}`;

    return {
        id: input.eventId,
        type: "TEXT",
        status: "PENDING",
        timestamp: now,
        scan_datetime: now,
        is_user_submitted: true,
        location: { lat: input.lat, lng: input.lng, address },
        area_location: {
            lat: input.topicPayload.areas[0]?.lat ?? input.lat,
            lng: input.topicPayload.areas[0]?.lng ?? input.lng,
            address: `${input.parsed.area}, ${input.parsed.city}`,
        },
        place: input.parsed.place,
        category: input.parsed.topic,
        mission_context: input.parsed.summary_en,
        ai_summary: input.parsed.summary_en,
        event_tags: input.parsed.event_tags,
        source_trail: (input.topicPayload.source_trail || []).map((entry: any) =>
            typeof entry === "string"
                ? { type: "social", json_dump_response: { source: entry } }
                : entry
        ),
        thumbnail: input.thumbnailPath,
        raw_input: JSON.stringify(input.topicPayload, null, 2),
        road_coords: {
            lat: input.lat,
            lng: input.lng,
            source: "USER_GPS",
        },
    };
}

export async function upsertUserScanEvent(
    incident: Incident,
    meta?: { city?: string; area?: string },
): Promise<{ event_id: string; updated_at: string }> {
    const supabase = getSupabaseServiceClient();
    const location = incident.location || { lat: 0, lng: 0 };
    const areaLocation = incident.area_location;

    let city = meta?.city || null;
    let area = meta?.area || null;
    if ((!city || !area) && incident.raw_input?.startsWith("{")) {
        try {
            const parsed = JSON.parse(incident.raw_input);
            city = city || parsed?.city || null;
            area = area || parsed?.areas?.[0]?.name || null;
        } catch {
            // ignore
        }
    }

    const payload = {
        event_id: incident.id,
        type: incident.type || "TEXT",
        category: incident.category || null,
        priority: incident.priority || "LOW",
        status: incident.status || "PENDING",
        city,
        area,
        area_lat: areaLocation?.lat ?? null,
        area_lng: areaLocation?.lng ?? null,
        lat: location.lat,
        lng: location.lng,
        address: location.address || null,
        event_tags: incident.event_tags || [],
        source_trail: incident.source_trail || [{ type: "social", json_dump_response: { source: "USER_SUBMITTED" } }],
        road_coords: incident.road_coords || null,
        ai_summary: incident.ai_summary || incident.mission_context || null,
        thumbnail: incident.thumbnail || null,
        scan_datetime: incident.scan_datetime || incident.timestamp,
        news_date: null,
        raw_input: incident.raw_input || null,
        mission_context: incident.mission_context || null,
        is_user_submitted: true,
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .upsert(payload, { onConflict: "event_id" })
        .select("event_id, updated_at")
        .single();

    if (error) {
        if (shouldUseSupabaseTlsFallback(error)) {
            logSupabaseTlsFallbackOnce("USER-REPORTS-UPSERT");
            return upsertUserScanEventViaSupabaseRest(payload);
        }
        throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    return data as { event_id: string; updated_at: string };
}

export { buildEventId };
