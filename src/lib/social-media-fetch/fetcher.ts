import type { AlertSource, SocialPost } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

interface FetchPostsInput {
    query: string;
    source: AlertSource;
}

interface ProviderResponse {
    count?: number;
    posts?: SocialPost[];
}

export async function fetchPosts({ query, source }: FetchPostsInput): Promise<SocialPost[]> {
    const base = process.env.SOCIAL_MEDIA_RESOURCE_API_BASE;
    const apiKey = process.env.SOCIAL_MEDIA_RESOURCE_API_KEY;

    if (!base || !apiKey) {
        console.warn("[social-media-fetch] SOCIAL_MEDIA_RESOURCE_API_BASE or SOCIAL_MEDIA_RESOURCE_API_KEY is missing");
        return [];
    }

    const url = new URL(`${base.replace(/\/$/, "")}${source.endpoint}`);
    url.searchParams.set("query", query);
    url.searchParams.set("sort_by", "relevance");
    url.searchParams.set("page", "1");
    url.searchParams.set("get_sentiment", "true");

    try {
        console.log("\n========================");
        console.log("FINAL QUERY:", query);
        console.log("url:", url.toString());
        console.log("========================\n");

        const response = await fetch(url, {
            method: "GET",
            headers: { "x-api-key": apiKey },
            cache: "no-store",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const text = await response.text();
            console.log("\n❌ API ERROR DETAILS:");
            console.log("STATUS:", response.status);
            console.log("DATA:", text.substring(0, 500));
            return [];
        }

        const data = (await response.json()) as ProviderResponse;
        console.log("STATUS:", response.status);
        console.log("COUNT:", data.count);
        console.log("POSTS:", data.posts?.length);

        return data.posts ?? [];
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log("\n❌ API ERROR DETAILS:");
        console.log("MESSAGE:", message);
        return [];
    }
}
