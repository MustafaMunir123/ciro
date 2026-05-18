import { getSupabaseServiceClient } from "@/lib/supabase";
import {
    fetchWithInsecureTls,
    getSupabaseRestConfig,
    logSupabaseTlsFallbackOnce,
    shouldUseSupabaseTlsFallback,
} from "@/lib/supabase-tls-fallback";
import { generateEventSummaryAndPrecautions } from "@/lib/event-ai-enrichment";
import type { Incident } from "@/lib/types";
import type { ParsedUserSubmission, UserSubmissionTopicPayload } from "./types";

const TABLE_NAME = "scan_events";
const PRIORITY_RANDOM_POOL = ["MEDIUM", "LOW", "HIGH"] as const;

function resolvePriorityWithRandomFallback(inputPriority: unknown, eventId: string): "MEDIUM" | "LOW" | "HIGH" | "CRITICAL" {
    const clean = String(inputPriority || "").trim().toUpperCase();
    if (clean === "LOW" || clean === "MEDIUM" || clean === "HIGH" || clean === "CRITICAL") {
        return clean;
    }
    const seed = String(eventId || "")
        .split("")
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return PRIORITY_RANDOM_POOL[seed % PRIORITY_RANDOM_POOL.length];
}

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

function buildEarlyUserReportSummary(input: {
    topic: string;
    place: string;
    area: string;
    city: string;
    summaryEn: string;
    records: Array<{ source?: string; headline?: string; published_at?: string }>;
}): string {
    const base = String(input.summaryEn || "").replace(/\s+/g, " ").trim();
    const topRefs = (Array.isArray(input.records) ? input.records : [])
        .slice(0, 2)
        .map((record) => {
            const source = String(record?.source || "SOURCE").trim();
            const headline = String(record?.headline || "").replace(/\s+/g, " ").trim();
            if (!headline) return "";
            return `[${source}] ${headline}`;
        })
        .filter(Boolean);

    const header = `${input.topic} reported near ${input.place} (${input.area}, ${input.city}).`;
    if (topRefs.length > 0) {
        return `${header} ${base} References: ${topRefs.join(" | ")}`.slice(0, 1000);
    }
    return `${header} ${base}`.slice(0, 1000);
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
    const topicRecords = Array.isArray(input.topicPayload.intel_by_topic?.[0]?.records)
        ? input.topicPayload.intel_by_topic[0].records
        : [];
    const earlySummary = buildEarlyUserReportSummary({
        topic: input.parsed.topic,
        place: input.parsed.place,
        area: input.parsed.area,
        city: input.parsed.city,
        summaryEn: input.parsed.summary_en,
        records: topicRecords.map((record: any) => ({
            source: record?.source,
            headline: record?.headline,
            published_at: record?.published_at,
        })),
    });

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
        ai_summary: earlySummary,
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

    const enrichment = await generateEventSummaryAndPrecautions({
        ai_summary: incident.ai_summary || incident.mission_context || null,
        category: incident.category || null,
        city,
        area,
        event_tags: incident.event_tags || [],
        mission_context: incident.mission_context || null,
        raw_input: incident.raw_input || null,
    });

    const payload = {
        event_id: incident.id,
        type: incident.type || "TEXT",
        category: incident.category || null,
        priority: resolvePriorityWithRandomFallback(incident.priority, incident.id),
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
        ai_summary: enrichment.ai_summary,
        precautions: enrichment.precautions,
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
