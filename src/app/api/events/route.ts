import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { persistRemoteImageToLocalPath } from "@/lib/local-image-store";
import { generateEventSummaryAndPrecautions } from "@/lib/event-ai-enrichment";

export const runtime = "nodejs";

const TABLE_NAME = "scan_events";
const SUPABASE_TLS_INSECURE_FALLBACK = process.env.SUPABASE_TLS_INSECURE_FALLBACK !== "false";
let hasLoggedSupabaseTlsFallback = false;

function parseCityArea(address?: string | null): { city: string | null; area: string | null } {
    if (!address) return { city: null, area: null };
    const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        const countryLike = new Set(["pakistan", "pk"]);
        const last = parts[parts.length - 1];
        const lastLower = last.toLowerCase();

        // Handle common "City, Country" patterns where country would otherwise be mis-grouped as city.
        if (countryLike.has(lastLower) && parts.length >= 2) {
            return {
                area: parts.length >= 3 ? parts[0] : null,
                city: parts[parts.length - 2],
            };
        }

        return { area: parts[0], city: last };
    }
    return { city: null, area: address.trim() || null };
}

function buildTagSet(body: any): string[] {
    const tags = new Set<string>();
    const pushTag = (value: unknown) => {
        if (typeof value !== "string") return;
        const clean = value.trim();
        if (!clean) return;
        tags.add(clean);
    };

    if (Array.isArray(body?.event_tags)) {
        body.event_tags.forEach(pushTag);
    }

    const category = String(body?.category || "").toLowerCase();
    const mission = String(body?.mission_context || "").toLowerCase();
    const combinedText = `${category} ${mission}`;

    if (combinedText.includes("road") || combinedText.includes("gridlock") || combinedText.includes("closure") || combinedText.includes("block")) {
        tags.add("roadblockage");
    }
    if (combinedText.includes("fire") || combinedText.includes("blast") || combinedText.includes("smoke")) {
        tags.add("fireHazard");
    }
    if (combinedText.includes("flood") || combinedText.includes("rainwater") || combinedText.includes("monsoon")) {
        tags.add("floodRisk");
    }
    if (combinedText.includes("protest") || combinedText.includes("sit-in") || combinedText.includes("dharna") || combinedText.includes("hartal")) {
        tags.add("civilUnrest");
    }
    if (combinedText.includes("weather")) {
        tags.add("weather");
    }

    return Array.from(tags);
}

function extractNewsDate(rawInput?: string): string | null {
    if (!rawInput || !rawInput.startsWith("{")) return null;
    try {
        const parsed = JSON.parse(rawInput);
        const topics = Array.isArray(parsed?.intel_by_topic) ? parsed.intel_by_topic : [];
        const allDates: number[] = [];
        for (const topicEntry of topics) {
            const records = Array.isArray(topicEntry?.records) ? topicEntry.records : [];
            for (const record of records) {
                const publishedAt = record?.published_at;
                if (typeof publishedAt === "string") {
                    const ts = Date.parse(publishedAt);
                    if (Number.isFinite(ts)) allDates.push(ts);
                }
            }
        }
        if (allDates.length === 0) return null;
        return new Date(Math.max(...allDates)).toISOString();
    } catch {
        return null;
    }
}

function buildAiSummary(body: any): string | null {
    const candidate =
        body?.ai_summary ||
        body?.reasoning_trace ||
        body?.mission_context ||
        null;
    if (!candidate || typeof candidate !== "string") return null;
    return candidate.slice(0, 1000);
}

async function resolveThumbnailPath(body: any, eventId: string): Promise<string | null> {
    const normalizeLocalThumbnailPath = (value: unknown): string | null => {
        if (typeof value !== "string") return null;
        const clean = value.trim();
        if (!clean) return null;
        return clean.startsWith("/event-thumbnails/") ? clean : null;
    };
    const normalizeRemoteThumbnailUrl = (value: unknown): string | null => {
        if (typeof value !== "string") return null;
        const clean = value.trim();
        if (!clean) return null;
        if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
        return null;
    };

    const directLocal = normalizeLocalThumbnailPath(body?.thumbnail);
    if (directLocal) return directLocal;
    const directRemote = normalizeRemoteThumbnailUrl(body?.thumbnail);
    if (directRemote) {
        const persisted = await persistRemoteImageToLocalPath(directRemote, eventId);
        return persisted || null;
    }

    const rawInput = body?.raw_input;
    if (typeof rawInput !== "string" || !rawInput.startsWith("{")) return null;
    try {
        const parsed = JSON.parse(rawInput);
        const topics = Array.isArray(parsed?.intel_by_topic) ? parsed.intel_by_topic : [];
        for (const topicEntry of topics) {
            const records = Array.isArray(topicEntry?.records) ? topicEntry.records : [];
            const preferredLocal = records.find((record: any) => record?.source === "NEWS_API" && normalizeLocalThumbnailPath(record?.thumbnail));
            const preferredLocalThumb = normalizeLocalThumbnailPath(preferredLocal?.thumbnail);
            if (preferredLocalThumb) return preferredLocalThumb;

            const preferredRemote = records.find((record: any) => record?.source === "NEWS_API" && normalizeRemoteThumbnailUrl(record?.thumbnail));
            const preferredRemoteThumb = normalizeRemoteThumbnailUrl(preferredRemote?.thumbnail);
            if (preferredRemoteThumb) {
                const persisted = await persistRemoteImageToLocalPath(preferredRemoteThumb, eventId);
                if (persisted) return persisted;
            }

            const fallbackLocal = records.find((record: any) => normalizeLocalThumbnailPath(record?.thumbnail));
            const fallbackLocalThumb = normalizeLocalThumbnailPath(fallbackLocal?.thumbnail);
            if (fallbackLocalThumb) return fallbackLocalThumb;

            const fallbackRemote = records.find((record: any) => normalizeRemoteThumbnailUrl(record?.thumbnail));
            const fallbackRemoteThumb = normalizeRemoteThumbnailUrl(fallbackRemote?.thumbnail);
            if (fallbackRemoteThumb) {
                const persisted = await persistRemoteImageToLocalPath(fallbackRemoteThumb, eventId);
                if (persisted) return persisted;
            }
        }
    } catch {
        return null;
    }
    return null;
}

function buildSourceTrail(body: any): Array<{ type: "news" | "social" | "weather"; json_dump_response: unknown }> | null {
    const parseJsonLike = (value: unknown): unknown => {
        if (typeof value !== "string") return value;
        const clean = value.trim();
        if (!(clean.startsWith("{") || clean.startsWith("["))) return value;
        try {
            return JSON.parse(clean);
        } catch {
            return value;
        }
    };

    const inferTypeFromDump = (dump: unknown): "news" | "social" | "weather" | null => {
        if (Array.isArray(dump)) {
            const sources = dump
                .map((item) => String((item as any)?.source || "").toUpperCase())
                .filter(Boolean);
            if (sources.some((source) => source === "SOCIAL_API")) return "social";
            if (sources.some((source) => source === "NEWS_API")) return "news";
            return null;
        }
        if (dump && typeof dump === "object") {
            const obj = dump as Record<string, unknown>;
            if ("current" in obj || "forecast_day1" in obj) return "weather";
            const source = String((obj as any)?.source || "").toUpperCase();
            if (source === "SOCIAL_API") return "social";
            if (source === "NEWS_API") return "news";
            return null;
        }
        const text = String(dump || "").toUpperCase();
        if (text.includes("WEATHER")) return "weather";
        if (text.includes("SOCIAL")) return "social";
        if (text.includes("NEWS")) return "news";
        return null;
    };

    const normalizeEntry = (rawEntry: unknown) => {
        let entry: any = parseJsonLike(rawEntry);
        let type = String(entry?.type || "").toLowerCase();
        let dump = parseJsonLike(entry?.json_dump_response);

        // Legacy bad shape: json_dump_response itself contains {"type","json_dump_response"} as string/object.
        for (let i = 0; i < 3; i += 1) {
            if (!dump || typeof dump !== "object" || Array.isArray(dump)) break;
            const nestedType = String((dump as any)?.type || "").toLowerCase();
            const nestedDump = (dump as any)?.json_dump_response;
            if (!nestedDump) break;
            if ((type !== "news" && type !== "social" && type !== "weather") && (nestedType === "news" || nestedType === "social" || nestedType === "weather")) {
                type = nestedType;
            }
            dump = parseJsonLike(nestedDump);
        }

        if (type !== "news" && type !== "social" && type !== "weather") {
            type = inferTypeFromDump(dump) || inferTypeFromDump(entry) || "";
        }
        if (type !== "news" && type !== "social" && type !== "weather") return null;

        return {
            type: type as "news" | "social" | "weather",
            json_dump_response: dump ?? null,
        };
    };

    if (Array.isArray(body?.source_trail)) {
        const normalized = body.source_trail.map(normalizeEntry).filter(Boolean) as Array<{ type: "news" | "social" | "weather"; json_dump_response: unknown }>;
        if (normalized.length > 0) return normalized;
    }

    const rawInput = body?.raw_input;
    if (typeof rawInput !== "string" || !rawInput.startsWith("{")) return null;
    try {
        const parsed = JSON.parse(rawInput);
        const topics = Array.isArray(parsed?.intel_by_topic) ? parsed.intel_by_topic : [];
        const newsRecords: any[] = [];
        const socialRecords: any[] = [];
        for (const topicEntry of topics) {
            const records = Array.isArray(topicEntry?.records) ? topicEntry.records : [];
            for (const record of records) {
                if (record?.source === "NEWS_API") newsRecords.push(record);
                if (record?.source === "SOCIAL_API") socialRecords.push(record);
            }
        }

        const entries: Array<{ type: "news" | "social" | "weather"; json_dump_response: unknown }> = [];
        if (newsRecords.length > 0) entries.push({ type: "news", json_dump_response: newsRecords });
        if (socialRecords.length > 0) entries.push({ type: "social", json_dump_response: socialRecords });
        if (parsed?.weather?.current || parsed?.weather?.forecast_day1) {
            entries.push({
                type: "weather",
                json_dump_response: {
                    current: parsed?.weather?.current ?? null,
                    forecast_day1: parsed?.weather?.forecast_day1 ?? null,
                },
            });
        }
        return entries.length > 0 ? entries : null;
    } catch {
        return null;
    }
}

function parseAreaCoords(body: any): { lat: number | null; lng: number | null } {
    const areaLocation = body?.area_location;
    if (typeof areaLocation?.lat === "number" && typeof areaLocation?.lng === "number") {
        return { lat: areaLocation.lat, lng: areaLocation.lng };
    }

    const rawInput = body?.raw_input;
    if (typeof rawInput === "string" && rawInput.startsWith("{")) {
        try {
            const parsed = JSON.parse(rawInput);
            if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
                return { lat: parsed.lat, lng: parsed.lng };
            }
            if (typeof parsed?.area_location?.lat === "number" && typeof parsed?.area_location?.lng === "number") {
                return { lat: parsed.area_location.lat, lng: parsed.area_location.lng };
            }
        } catch {
            // Ignore JSON parse issues and continue.
        }
    }

    return { lat: null, lng: null };
}

function getSupabaseRestConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    return { url, key };
}

function getErrorCode(error: any): string | undefined {
    return error?.code || error?.cause?.code;
}

function shouldUseSupabaseTlsFallback(error: any): boolean {
    if (!SUPABASE_TLS_INSECURE_FALLBACK) return false;
    const errorCode = getErrorCode(error);
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return (
        errorCode === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
        message.includes("fetch failed") ||
        details.includes("unable to get local issuer certificate")
    );
}

function logSupabaseTlsFallbackOnce(scope: "GET" | "POST") {
    if (!hasLoggedSupabaseTlsFallback) {
        console.warn(`[EVENTS][${scope}] Supabase TLS certificate chain not trusted. Using insecure TLS fallback for this environment.`);
        hasLoggedSupabaseTlsFallback = true;
    }
}

async function fetchWithInsecureTls(url: string, init: RequestInit): Promise<Response> {
    const https = await import("https");
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                method: init.method || "GET",
                headers: init.headers as Record<string, string>,
                rejectUnauthorized: false,
            },
            (res) => {
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
            }
        );
        request.on("error", reject);
        if (init.body) request.write(init.body as string);
        request.end();
    });
}

async function upsertViaSupabaseRest(payload: Record<string, unknown>) {
    const config = getSupabaseRestConfig();
    if (!config) {
        return { data: null, error: "Supabase REST config missing" };
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
            logSupabaseTlsFallbackOnce("POST");
            response = await fetchWithInsecureTls(endpoint, init);
        } else {
            return { data: null, error: error?.message || "Supabase REST fetch failed" };
        }
    }

    if (!response.ok) {
        const details = await response.text();
        return { data: null, error: `Supabase REST upsert failed (${response.status}): ${details}` };
    }

    const json = (await response.json()) as Array<{ event_id: string; updated_at: string }>;
    return { data: json?.[0] || null, error: null };
}

async function fetchEventsViaSupabaseRest(params: { limit: number; city: string | null; area: string | null; status: string | null; eventId: string | null }) {
    const config = getSupabaseRestConfig();
    if (!config) {
        return { data: null, error: "Supabase REST config missing" };
    }

    const query = new URLSearchParams();
    query.set("select", "*");
    query.set("order", "updated_at.desc");
    query.set("limit", String(params.limit));
    if (params.city) query.set("city", `eq.${params.city}`);
    if (params.area) query.set("area", `eq.${params.area}`);
    if (params.status) query.set("status", `eq.${params.status}`);
    if (params.eventId) query.set("event_id", `eq.${params.eventId}`);

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
            logSupabaseTlsFallbackOnce("GET");
            response = await fetchWithInsecureTls(endpoint, init);
        } else {
            return { data: null, error: error?.message || "Supabase REST fetch failed" };
        }
    }

    if (!response.ok) {
        const details = await response.text();
        return { data: null, error: `Supabase REST fetch failed (${response.status}): ${details}` };
    }

    const json = (await response.json()) as unknown[];
    return { data: json || [], error: null };
}

async function deleteEventsViaSupabaseRest(params: { all: boolean; ids: string[] }) {
    const config = getSupabaseRestConfig();
    if (!config) {
        return { data: null, error: "Supabase REST config missing" };
    }

    const query = new URLSearchParams();
    query.set("select", "event_id");
    if (params.all) {
        query.set("event_id", "not.is.null");
    } else if (params.ids.length > 0) {
        query.set("event_id", `in.(${params.ids.join(",")})`);
    } else {
        return { data: [], error: null };
    }

    const endpoint = `${config.url}/rest/v1/${TABLE_NAME}?${query.toString()}`;
    const init: RequestInit = {
        method: "DELETE",
        headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
            Prefer: "return=representation",
        },
    };

    let response: Response;
    try {
        response = await fetch(endpoint, init);
    } catch (error: any) {
        if (shouldUseSupabaseTlsFallback(error)) {
            logSupabaseTlsFallbackOnce("POST");
            response = await fetchWithInsecureTls(endpoint, init);
        } else {
            return { data: null, error: error?.message || "Supabase REST delete failed" };
        }
    }

    if (!response.ok) {
        const details = await response.text();
        return { data: null, error: `Supabase REST delete failed (${response.status}): ${details}` };
    }

    const json = (await response.json()) as Array<{ event_id: string }>;
    return { data: json || [], error: null };
}

function toCompactEvent(row: any) {
    return {
        event_id: row?.event_id ?? null,
        type: row?.type ?? null,
        category: row?.category ?? null,
        priority: row?.priority ?? null,
        status: row?.status ?? null,
        city: row?.city ?? null,
        area: row?.area ?? null,
        area_lat: row?.area_lat ?? null,
        area_lng: row?.area_lng ?? null,
        lat: row?.lat ?? null,
        lng: row?.lng ?? null,
        address: row?.address ?? null,
        event_tags: row?.event_tags ?? null,
        source_trail: row?.source_trail ?? null,
        road_coords: row?.road_coords ?? null,
        ai_summary: row?.ai_summary ?? null,
        precautions: row?.precautions ?? null,
        thumbnail: row?.thumbnail ?? null,
        scan_datetime: row?.scan_datetime ?? null,
        news_date: row?.news_date ?? null,
        updated_at: row?.updated_at ?? null,
        is_user_submitted: row?.is_user_submitted ?? false,
    };
}

function pickEventFields(row: any, fields: string[]) {
    const selected: Record<string, unknown> = {};
    for (const field of fields) {
        if (!field) continue;
        if (Object.prototype.hasOwnProperty.call(row, field)) {
            selected[field] = row[field];
        }
    }
    return selected;
}

export async function GET(req: NextRequest) {
    try {
        const supabase = getSupabaseServiceClient();
        const { searchParams } = new URL(req.url);
        const limitParam = Number(searchParams.get("limit") || 50);
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, limitParam)) : 50;
        const city = searchParams.get("city");
        const area = searchParams.get("area");
        const status = searchParams.get("status");
        const eventId = searchParams.get("event_id");
        const view = (searchParams.get("view") || "compact").toLowerCase();
        const fullView = view === "full";
        const fieldsParam = searchParams.get("fields");
        const requestedFields = fieldsParam
            ? fieldsParam.split(",").map((field) => field.trim()).filter(Boolean)
            : [];

        let query = supabase
            .from(TABLE_NAME)
            .select("*")
            .order("updated_at", { ascending: false })
            .limit(limit);

        if (city) query = query.eq("city", city);
        if (area) query = query.eq("area", area);
        if (status) query = query.eq("status", status);
        if (eventId) query = query.eq("event_id", eventId);

        const { data, error } = await query;
        if (error) {
            if (shouldUseSupabaseTlsFallback(error)) {
                logSupabaseTlsFallbackOnce("GET");
                const fallback = await fetchEventsViaSupabaseRest({ limit, city, area, status, eventId });
                if (fallback.error) {
                    return NextResponse.json({ error: fallback.error }, { status: 500 });
                }
                const rows = fallback.data || [];
                const eventsBase = fullView ? rows : rows.map(toCompactEvent);
                const events = requestedFields.length > 0
                    ? eventsBase.map((row: any) => pickEventFields(row, requestedFields))
                    : eventsBase;
                return NextResponse.json({ count: rows.length || 0, events });
            }
            console.error("[EVENTS][GET] Supabase query error:", error);
            return NextResponse.json(
                { error: `Supabase query failed: ${error.message}` },
                { status: 500 },
            );
        }

        const rows = data || [];
        const eventsBase = fullView ? rows : rows.map(toCompactEvent);
        const events = requestedFields.length > 0
            ? eventsBase.map((row: any) => pickEventFields(row, requestedFields))
            : eventsBase;
        return NextResponse.json({ count: rows.length || 0, events });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to fetch events from Supabase" },
            { status: 500 },
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();
        if (!rawBody || rawBody.trim().length === 0) {
            return NextResponse.json({ error: "Empty request body" }, { status: 400 });
        }

        let body: any;
        try {
            body = JSON.parse(rawBody);
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const id = body?.id;
        if (!id || typeof id !== "string") {
            return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
        }
        const thumbnailPath = await resolveThumbnailPath(body, id);

        const supabase = getSupabaseServiceClient();
        const location = body?.location || {};
        const { city, area } = parseCityArea(location?.address);
        const areaCoords = parseAreaCoords(body);
        const eventTags = buildTagSet(body);
        const enrichment = await generateEventSummaryAndPrecautions({
            ai_summary: buildAiSummary(body),
            category: body?.category || null,
            city,
            area,
            event_tags: eventTags,
            mission_context: body?.mission_context || null,
            raw_input: body?.raw_input || null,
        });

        const payload = {
            event_id: id,
            type: body?.type || null,
            category: body?.category || null,
            priority: body?.priority || "LOW",
            status: body?.status || null,
            city,
            area,
            area_lat: areaCoords.lat,
            area_lng: areaCoords.lng,
            lat: typeof location?.lat === "number" ? location.lat : null,
            lng: typeof location?.lng === "number" ? location.lng : null,
            address: location?.address || null,
            event_tags: eventTags,
            source_trail: buildSourceTrail(body),
            road_coords: body?.road_coords || null,
            ai_summary: enrichment.ai_summary,
            precautions: enrichment.precautions,
            thumbnail: thumbnailPath,
            scan_datetime: body?.timestamp || new Date().toISOString(),
            news_date: body?.news_date || extractNewsDate(body?.raw_input),
            raw_input: body?.raw_input || null,
            mission_context: body?.mission_context || null,
            is_user_submitted: Boolean(body?.is_user_submitted),
            updated_at: new Date().toISOString(),
        };

        let data: { event_id: string; updated_at: string } | null = null;
        let errorMessage: string | null = null;

        const { data: upsertData, error } = await supabase
            .from(TABLE_NAME)
            .upsert(payload, { onConflict: "event_id" })
            .select("event_id, updated_at")
            .single();

        if (error) {
            if (shouldUseSupabaseTlsFallback(error)) {
                logSupabaseTlsFallbackOnce("POST");
                const fallback = await upsertViaSupabaseRest(payload);
                data = fallback.data;
                errorMessage = fallback.error;
            } else {
                console.error("[EVENTS][POST] Supabase upsert error:", error);
                errorMessage = `Supabase upsert failed: ${error.message}`;
            }
        } else {
            data = upsertData;
        }

        if (errorMessage) {
            return NextResponse.json(
                {
                    error: errorMessage,
                    hint: "Ensure table scan_events exists with unique event_id column.",
                },
                { status: 500 },
            );
        }

        return NextResponse.json({ ok: true, event: data });
    } catch (error: any) {
        console.error("[EVENTS][POST] Route exception:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to write event to Supabase" },
            { status: 500 },
        );
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const supabase = getSupabaseServiceClient();
        const { searchParams } = new URL(req.url);
        const all = searchParams.get("all") === "true";
        const idsParam = searchParams.get("ids");
        const ids = (idsParam || "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);

        if (!all && ids.length === 0) {
            return NextResponse.json({ error: "Provide all=true or ids=a,b,c" }, { status: 400 });
        }

        let query = supabase.from(TABLE_NAME).delete().select("event_id");
        if (all) {
            query = query.not("event_id", "is", null);
        } else {
            query = query.in("event_id", ids);
        }

        const { data, error } = await query;
        if (error) {
            if (shouldUseSupabaseTlsFallback(error)) {
                logSupabaseTlsFallbackOnce("POST");
                const fallback = await deleteEventsViaSupabaseRest({ all, ids });
                if (fallback.error) {
                    return NextResponse.json({ error: fallback.error }, { status: 500 });
                }
                return NextResponse.json({ ok: true, deleted: fallback.data?.length || 0 });
            }
            return NextResponse.json({ error: `Supabase delete failed: ${error.message}` }, { status: 500 });
        }

        return NextResponse.json({ ok: true, deleted: data?.length || 0 });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to delete events from Supabase" },
            { status: 500 }
        );
    }
}

