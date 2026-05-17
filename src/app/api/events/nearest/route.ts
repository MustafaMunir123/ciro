import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { distanceKm } from "@/lib/geo-utils";

export const runtime = "nodejs";

const TABLE_NAME = "scan_events";
const SUPABASE_TLS_INSECURE_FALLBACK = process.env.SUPABASE_TLS_INSECURE_FALLBACK !== "false";

type ScanEventRow = Record<string, any>;

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
        request.end();
    });
}

function normalizeCity(city?: string | null): string {
    return (city || "").trim().toLowerCase();
}

function pickEventFields(row: ScanEventRow, fields: string[]) {
    const selected: Record<string, unknown> = {};
    for (const field of fields) {
        if (!field) continue;
        if (Object.prototype.hasOwnProperty.call(row, field)) {
            selected[field] = row[field];
        }
    }
    return selected;
}

async function fetchCityEventsViaSupabaseRest(city?: string | null): Promise<{ data: ScanEventRow[] | null; error: string | null }> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
        return { data: null, error: "Supabase REST config missing" };
    }

    const query = new URLSearchParams();
    query.set("select", "*");
    if (city?.trim()) {
        query.set("city", `ilike.${city.trim()}`);
    }
    query.set("order", "updated_at.desc");
    query.set("limit", "2000");
    const endpoint = `${url}/rest/v1/${TABLE_NAME}?${query.toString()}`;

    const init: RequestInit = {
        method: "GET",
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
        },
    };

    let response: Response;
    try {
        response = await fetch(endpoint, init);
    } catch (error: any) {
        if (shouldUseSupabaseTlsFallback(error)) {
            response = await fetchWithInsecureTls(endpoint, init);
        } else {
            return { data: null, error: error?.message || "Supabase REST fetch failed" };
        }
    }

    if (!response.ok) {
        const details = await response.text();
        return { data: null, error: `Supabase REST fetch failed (${response.status}): ${details}` };
    }

    const json = (await response.json()) as ScanEventRow[];
    return { data: json || [], error: null };
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const city = (searchParams.get("city") || "").trim();
        const eventId = (searchParams.get("event_id") || "").trim();
        const fieldsParam = (searchParams.get("fields") || "").trim();
        const requestedFields = fieldsParam
            ? fieldsParam.split(",").map((field) => field.trim()).filter(Boolean)
            : [];
        const userLat = Number(searchParams.get("lat"));
        const userLng = Number(searchParams.get("lng"));
        const limitParam = Number(searchParams.get("limit") || 50);
        const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, limitParam)) : 50;

        if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
            return NextResponse.json({ error: "Missing/invalid lat or lng query params" }, { status: 400 });
        }

        const supabase = getSupabaseServiceClient();
        let rows: ScanEventRow[] = [];
        let query = supabase
            .from(TABLE_NAME)
            .select("*")
            .not("area_lat", "is", null)
            .not("area_lng", "is", null)
            .order("updated_at", { ascending: false })
            .limit(2000);
        if (city) {
            query = query.ilike("city", city);
        }
        const { data, error } = await query;

        if (error) {
            if (shouldUseSupabaseTlsFallback(error)) {
                const fallback = await fetchCityEventsViaSupabaseRest(city);
                if (fallback.error) {
                    return NextResponse.json({ error: fallback.error }, { status: 500 });
                }
                rows = (fallback.data || []).filter((row) => row?.area_lat != null && row?.area_lng != null);
            } else {
                return NextResponse.json({ error: `Supabase query failed: ${error.message}` }, { status: 500 });
            }
        } else {
            rows = data || [];
        }

        const cityNorm = normalizeCity(city);
        const cityRows = cityNorm
            ? rows.filter((row) => normalizeCity(row?.city) === cityNorm)
            : rows;
        if (cityRows.length === 0) {
            return NextResponse.json({
                count: 0,
                nearest_area: null,
                events: [],
            });
        }

        const areaGroups = new Map<string, { area: string | null; area_lat: number; area_lng: number; rows: ScanEventRow[] }>();
        for (const row of cityRows) {
            const lat = Number(row?.area_lat);
            const lng = Number(row?.area_lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
            if (!areaGroups.has(key)) {
                areaGroups.set(key, { area: row?.area ?? null, area_lat: lat, area_lng: lng, rows: [] });
            }
            areaGroups.get(key)!.rows.push(row);
        }

        let bestKey: string | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const [key, group] of areaGroups.entries()) {
            const d = distanceKm(userLat, userLng, group.area_lat, group.area_lng);
            if (d < bestDistance) {
                bestDistance = d;
                bestKey = key;
            }
        }

        if (!bestKey) {
            return NextResponse.json({
                count: 0,
                nearest_area: null,
                events: [],
            });
        }

        const nearest = areaGroups.get(bestKey)!;
        const nearestRows = nearest.rows
            .sort((a, b) => Date.parse(b?.updated_at || 0) - Date.parse(a?.updated_at || 0))
            .filter((row) => !eventId || String(row?.event_id || "") === eventId)
            .slice(0, limit);
        const events = requestedFields.length > 0
            ? nearestRows.map((row) => pickEventFields(row, requestedFields))
            : nearestRows;

        return NextResponse.json({
            count: events.length,
            nearest_area: {
                city: city || nearest.rows[0]?.city || null,
                area: nearest.area,
                area_lat: nearest.area_lat,
                area_lng: nearest.area_lng,
                distance_km: Number(bestDistance.toFixed(3)),
            },
            events,
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Failed to fetch nearest-area events" },
            { status: 500 }
        );
    }
}
