export type ExternalSource = "NEWS_API" | "SOCIAL_API";

export interface DisasterIntelQuery {
    query: string;
    city: string;
    area: string;
    topic?: string;
    limit?: number;
    language?: string;
}

export interface DisasterIntelRecord {
    id: string;
    source: ExternalSource;
    title: string;
    content: string;
    url?: string;
    author?: string;
    published_at?: string;
    thumbnail?: string;
    city: string;
    area: string;
    topic?: string;
    tags?: string[];
    raw: unknown;
}

export interface DisasterIntelResponse {
    query: string;
    city: string;
    area: string;
    topic?: string;
    fetched_at: string;
    results: DisasterIntelRecord[];
    source_health: {
        news_api: "configured" | "missing_config" | "error";
        social_api: "configured" | "missing_config" | "error";
    };
    provider_errors?: string[];
}

const DEFAULT_LIMIT = 10;
const NEWS_TOP_RESULTS_LIMIT = 3;
const DEFAULT_LANGUAGE = "en";
const NEWS_API_TLS_INSECURE_FALLBACK = process.env.NEWS_API_TLS_INSECURE_FALLBACK !== "false";
const SOCIAL_MEDIA_RESOURCE_TIMEOUT_MS = 15_000;
const PAGE_IMAGE_FETCH_TIMEOUT_MS = 10_000;
const SOCIAL_MEDIA_RESOURCE_SOURCES = [
    { name: "twitter", endpoint: "/v1/twitter/posts" },
    { name: "reddit", endpoint: "/v1/reddit/posts" },
    { name: "facebook", endpoint: "/v1/facebook/posts" },
    { name: "googleNews", endpoint: "/v1/news/articles" },
] as const;

async function fetchWithInsecureTls(url: string): Promise<Response> {
    const https = await import("https");
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: "GET", rejectUnauthorized: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                resolve(
                    new Response(body, {
                        status: res.statusCode || 500,
                        headers: { "content-type": String(res.headers["content-type"] || "application/json") },
                    }),
                );
            });
        });
        req.on("error", reject);
        req.end();
    });
}

function getErrorCode(error: any): string | undefined {
    return error?.code || error?.cause?.code;
}

function extractMetaImageFromHtml(html: string): string | null {
    const patterns = [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    return null;
}

function resolveUrl(candidate: string, baseUrl: string): string | undefined {
    try {
        return new URL(candidate, baseUrl).toString();
    } catch {
        return undefined;
    }
}

async function fetchPageImage(url: string): Promise<string | undefined> {
    if (!url) return undefined;

    let response: Response;
    try {
        response = await fetch(url, {
            method: "GET",
            cache: "no-store",
            signal: AbortSignal.timeout(PAGE_IMAGE_FETCH_TIMEOUT_MS),
            headers: {
                "user-agent": "Mozilla/5.0 (compatible; CIRO/1.0)",
                "accept-language": "en-US,en;q=0.8",
            },
        });
    } catch (error: any) {
        if (NEWS_API_TLS_INSECURE_FALLBACK && getErrorCode(error) === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
            response = await fetchWithInsecureTls(url);
        } else {
            return undefined;
        }
    }

    if (!response.ok) return undefined;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (contentType.startsWith("image/")) {
        return url;
    }
    if (!contentType.includes("text/html")) {
        return undefined;
    }

    const html = await response.text();
    const metaImage = extractMetaImageFromHtml(html);
    if (!metaImage) return undefined;

    return resolveUrl(metaImage, url);
}

function looksLikeImageUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const candidate = value.trim().toLowerCase();
    if (!candidate.startsWith("http")) return false;
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic"].some((ext) => candidate.includes(ext))
        || candidate.includes("image")
        || candidate.includes("thumb");
}

function readThumbnailFromUnknown(value: unknown): string | undefined {
    if (!value) return undefined;
    if (looksLikeImageUrl(value)) return String(value).trim();

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = readThumbnailFromUnknown(item);
            if (found) return found;
        }
        return undefined;
    }

    if (typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;

    const directKeys = [
        "thumbnail",
        "thumbnail_url",
        "image",
        "image_url",
        "photo",
        "src",
        "url",
        "original",
    ];
    for (const key of directKeys) {
        const found = readThumbnailFromUnknown(record[key]);
        if (found) return found;
    }

    const nestedKeys = [
        "images",
        "image_set",
        "media",
        "media_content",
        "content",
        "pagemap",
        "cse_image",
        "thumbnail_data",
    ];
    for (const key of nestedKeys) {
        const found = readThumbnailFromUnknown(record[key]);
        if (found) return found;
    }

    return undefined;
}

function buildSearchText(input: DisasterIntelQuery): string {
    const parts = [input.query, input.area, input.city, input.topic].filter(Boolean);
    return parts.join(" ").trim();
}

export function buildAreaTopicQuery(city: string, area: string, topic: string): DisasterIntelQuery {
    return {
        query: `${topic} ${area} ${city}`,
        city,
        area,
        topic,
    };
}

function normalizeList(payload: unknown): any[] {
    if (!payload || typeof payload !== "object") return [];
    const value = payload as Record<string, unknown>;

    if (Array.isArray(value.items)) return value.items as any[];
    if (Array.isArray(value.results)) return value.results as any[];
    if (Array.isArray(value.data)) return value.data as any[];
    if (Array.isArray(value.posts)) return value.posts as any[];
    if (Array.isArray(value.articles)) return value.articles as any[];
    if (Array.isArray(value.news_results)) return value.news_results as any[];

    return [];
}

function readString(record: Record<string, any>, keys: string[], fallback = ""): string {
    for (const key of keys) {
        const val = record[key];
        if (typeof val === "string" && val.trim().length > 0) return val.trim();
    }
    return fallback;
}

function readArray(record: Record<string, any>, keys: string[]): string[] | undefined {
    for (const key of keys) {
        const val = record[key];
        if (Array.isArray(val)) {
            const tags = val.filter((v) => typeof v === "string").map((v) => String(v));
            if (tags.length > 0) return tags;
        }
    }
    return undefined;
}

async function fetchProvider(url: string, apiKey: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "x-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Provider request failed (${response.status}): ${text.substring(0, 200)}`);
    }

    return response.json();
}

function mapRecord(
    source: ExternalSource,
    item: Record<string, any>,
    context: DisasterIntelQuery,
    index: number,
): DisasterIntelRecord {
    const title = readString(item, ["title", "headline", "name"], `${source} item ${index + 1}`);
    const content = readString(item, ["content", "description", "snippet", "text", "body"], "");
    const url = readString(item, ["url", "link", "post_url", "permalink"], "");
    const author = readString(item, ["author", "source", "username", "user"], "");
    const publishedAt = readString(item, ["published_at", "publishedAt", "created_at", "date", "timestamp"], "");
    const thumbnail = readThumbnailFromUnknown(item) || readString(item, ["thumbnail", "thumbnail_url", "image", "image_url", "photo"], "");
    const tags = readArray(item, ["tags", "hashtags", "keywords"]);

    return {
        id: `${source}-${context.city}-${context.area}-${index}`,
        source,
        title,
        content,
        url: url || undefined,
        author: author || undefined,
        published_at: publishedAt || undefined,
        thumbnail: thumbnail || undefined,
        city: context.city,
        area: context.area,
        topic: context.topic,
        tags,
        raw: item,
    };
}

async function enrichMissingNewsThumbnails(records: DisasterIntelRecord[]): Promise<DisasterIntelRecord[]> {
    const enriched: DisasterIntelRecord[] = [];
    let foundOne = false;

    for (const record of records) {
        if (record.thumbnail || !record.url || foundOne) {
            enriched.push(record);
            continue;
        }

        const fetchedThumbnail = await fetchPageImage(record.url);
        if (fetchedThumbnail) {
            foundOne = true;
            enriched.push({ ...record, thumbnail: fetchedThumbnail });
        } else {
            enriched.push(record);
        }
    }

    return enriched;
}

async function searchNewsApi(input: DisasterIntelQuery): Promise<DisasterIntelRecord[]> {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) return [];

    // Mirrors news-api.js args exactly; only "q" is dynamic.
    const params = new URLSearchParams({
        documentation_path: "/google-news-light-api",
        api_key: apiKey,
        engine: "google_news_light",
        no_cache: "true",
        date: "01-08-2025",
        q: buildSearchText(input),
        google_domain: "google.com",
        safe: "off",
        filter: "0",
    });

    const requestUrl = `https://serpapi.com/search?${params.toString()}`;
    let response: Response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            cache: "no-store",
        });
    } catch (error: any) {
        const tlsCode = error?.cause?.code;
        if (NEWS_API_TLS_INSECURE_FALLBACK && tlsCode === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
            response = await fetchWithInsecureTls(requestUrl);
        } else {
            throw error;
        }
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`SerpAPI request failed (${response.status}): ${text.substring(0, 200)}`);
    }
    const json = await response.json();
    const items = normalizeList(json).slice(0, NEWS_TOP_RESULTS_LIMIT);
    const mapped = items.map((item, idx) => mapRecord("NEWS_API", item, input, idx));
    return enrichMissingNewsThumbnails(mapped);
}

async function searchSocialApi(input: DisasterIntelQuery): Promise<DisasterIntelRecord[]> {
    const resourceBase = process.env.SOCIAL_MEDIA_RESOURCE_API_BASE;
    const resourceApiKey = process.env.SOCIAL_MEDIA_RESOURCE_API_KEY;
    if (resourceBase && resourceApiKey) {
        const allRecords: DisasterIntelRecord[] = [];
        let sourceIndexOffset = 0;

        for (const source of SOCIAL_MEDIA_RESOURCE_SOURCES) {
            const url = new URL(`${resourceBase.replace(/\/$/, "")}${source.endpoint}`);
            url.searchParams.set("query", buildSearchText(input));
            url.searchParams.set("sort_by", "relevance");
            url.searchParams.set("page", "1");
            url.searchParams.set("get_sentiment", "true");

            try {
                const response = await fetch(url.toString(), {
                    method: "GET",
                    headers: { "x-api-key": resourceApiKey },
                    cache: "no-store",
                    signal: AbortSignal.timeout(SOCIAL_MEDIA_RESOURCE_TIMEOUT_MS),
                });
                if (!response.ok) {
                    continue;
                }
                const json = await response.json();
                const posts = Array.isArray((json as any)?.posts) ? (json as any).posts : [];
                const mapped = posts.map((item: Record<string, any>, idx: number) =>
                    mapRecord("SOCIAL_API", item, input, sourceIndexOffset + idx)
                );
                allRecords.push(...mapped.map((record) => ({
                    ...record,
                    author: record.author || source.name,
                })));
                sourceIndexOffset += posts.length;
            } catch {
                // Per-source failure is non-fatal; continue remaining sources.
            }
        }

        return allRecords;
    }

    const url = process.env.SOCIAL_API_URL;
    const apiKey = process.env.SOCIAL_API_KEY;
    if (!url || !apiKey) return [];

    const payload = {
        query: buildSearchText(input),
        city: input.city,
        area: input.area,
        topic: input.topic,
        limit: input.limit ?? DEFAULT_LIMIT,
        language: input.language ?? DEFAULT_LANGUAGE,
    };

    const json = await fetchProvider(url, apiKey, payload);
    const items = normalizeList(json);
    return items.map((item, idx) => mapRecord("SOCIAL_API", item, input, idx));
}

export async function fetchDisasterIntel(input: DisasterIntelQuery): Promise<DisasterIntelResponse> {
    // Strict sequential execution: fetch news first, then social.
    // This keeps provider calls deterministic for one-by-one processing flows.
    const providerErrors: string[] = [];
    let news: DisasterIntelRecord[] = [];
    let social: DisasterIntelRecord[] = [];

    try {
        news = await searchNewsApi(input);
    } catch (error: any) {
        providerErrors.push(`news_api: ${error?.message || "unknown error"}`);
    }

    try {
        social = await searchSocialApi(input);
    } catch (error: any) {
        providerErrors.push(`social_api: ${error?.message || "unknown error"}`);
    }

    const merged = [...news, ...social].sort((a, b) => {
        const aTs = a.published_at ? Date.parse(a.published_at) : 0;
        const bTs = b.published_at ? Date.parse(b.published_at) : 0;
        return bTs - aTs;
    });

    return {
        query: input.query,
        city: input.city,
        area: input.area,
        topic: input.topic,
        fetched_at: new Date().toISOString(),
        results: merged,
        source_health: {
            news_api: process.env.NEWS_API_KEY
                ? (providerErrors.some((e) => e.startsWith("news_api:")) ? "error" : "configured")
                : "missing_config",
            social_api: (process.env.SOCIAL_API_URL && process.env.SOCIAL_API_KEY)
                ? (providerErrors.some((e) => e.startsWith("social_api:")) ? "error" : "configured")
                : "missing_config",
        },
        provider_errors: providerErrors.length > 0 ? providerErrors : undefined,
    };
}
