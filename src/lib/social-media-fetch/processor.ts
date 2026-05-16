import type { AlertSeverity, ProcessedAlert, ScoredPost, SocialPost } from "./types";

function isValidPost(post: SocialPost): boolean {
    const text = (post.snippet || "").toLowerCase();

    const badNoise = [
        "inauguration",
        "game changer",
        "development",
        "project",
        "opening ceremony",
    ];

    const hasNoise = badNoise.some((w) => text.includes(w));

    const distressSignals = [
        "traffic",
        "blocked",
        "protest",
        "accident",
        "jam",
        "road",
        "flood",
        "rain",
        "water",
        "electricity",
        "pipe",
    ];

    const hasSignal = distressSignals.some((w) => text.includes(w));

    return hasSignal && !hasNoise;
}

export function classifyPost(post: SocialPost): ScoredPost {
    const polarity = post.sentiment?.polarity;
    let severity: AlertSeverity = "low";

    const text = (post.snippet || "").toLowerCase();

    const highRiskKeywords = [
        "road blocked",
        "traffic jam",
        "fire",
        "flood",
        "accident",
        "protest",
        "dharna",
        "shooting",
        "blasts",
    ];

    const isHigh = highRiskKeywords.some((k) => text.includes(k));

    if (polarity === "negative" && isHigh) {
        severity = "high";
    } else if (polarity === "negative") {
        severity = "medium";
    }

    return {
        ...post,
        severity,
    };
}

export function processPosts(posts: SocialPost[]): ProcessedAlert[] {
    return posts.filter(isValidPost).map((p) => ({
        text: p.snippet,
        time: p.date,
        source: p.url,
        sentiment: p.sentiment?.polarity,
        emotion: p.sentiment?.dominant_emotion,
    }));
}
