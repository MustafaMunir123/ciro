import { fetchPosts } from "./fetcher";
import { classifyPost } from "./processor";
import { buildQuery } from "./query-builder";
import { ALERT_SOURCES } from "./sources";
import type { AlertCategory, AlertSource, AlertSourceName, ClassifiedAlert } from "./types";

const ALERT_CATEGORIES: AlertCategory[] = ["traffic", "protest", "weather", "infra"];

let cache: ClassifiedAlert[] = [];
let refreshPromise: Promise<ClassifiedAlert[]> | null = null;

function deduplicatePosts(posts: ClassifiedAlert[]): ClassifiedAlert[] {
    const seen = new Set<string>();

    return posts.filter((post) => {
        const key = post.url || post.snippet || "";
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function fetchAlertsForSource(source: AlertSource): Promise<ClassifiedAlert[]> {
    const queries = buildQuery();
    const allPosts: ClassifiedAlert[] = [];

    console.log(`\n🌐 Source: ${source.name}`);

    for (const category of ALERT_CATEGORIES) {
        const query = queries[category];
        console.log(`📡 ${source.name} → ${category}`);

        const posts = await fetchPosts({ query, source });

        const tagged = posts.map((post) => ({
            ...classifyPost(post),
            category,
            source: source.name,
        }));

        allPosts.push(...tagged);
    }

    return deduplicatePosts(allPosts);
}

export async function fetchAlertsBySource(sourceName: AlertSourceName): Promise<ClassifiedAlert[]> {
    const source = ALERT_SOURCES.find((entry) => entry.name === sourceName);
    if (!source) {
        return [];
    }

    console.log(`\n🔄 Fetching alerts for source: ${sourceName}`);
    const alerts = await fetchAlertsForSource(source);
    console.log(`\n✅ ${sourceName} ALERTS: ${alerts.length}`);
    return alerts;
}

export async function refreshAlertsCache(): Promise<ClassifiedAlert[]> {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        try {
            console.log("\n🔄 Refreshing multi-source alerts...");

            const allPosts: ClassifiedAlert[] = [];

            for (const source of ALERT_SOURCES) {
                const sourceAlerts = await fetchAlertsForSource(source);
                allPosts.push(...sourceAlerts);
            }

            cache = deduplicatePosts(allPosts);
            console.log(`\n✅ TOTAL ALERTS: ${cache.length}`);
            return cache;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("❌ refreshAlertsCache failed:", message);
            return cache;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

export function getCachedAlerts(): ClassifiedAlert[] {
    return cache;
}
