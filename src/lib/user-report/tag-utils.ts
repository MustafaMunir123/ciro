const KNOWN_TAGS = ["roadblockage", "fireHazard", "floodRisk", "civilUnrest", "weather"] as const;

export function enrichEventTagsFromText(text: string, existing: string[] = []): string[] {
    const tags = new Set<string>(existing.map((t) => t.trim()).filter(Boolean));
    const combined = text.toLowerCase();

    if (combined.includes("road") || combined.includes("gridlock") || combined.includes("closure") || combined.includes("block") || combined.includes("rasta")) {
        tags.add("roadblockage");
    }
    if (combined.includes("fire") || combined.includes("blast") || combined.includes("smoke") || combined.includes("آگ")) {
        tags.add("fireHazard");
    }
    if (combined.includes("flood") || combined.includes("rain") || combined.includes("waterlogging") || combined.includes("barish") || combined.includes("pani") || combined.includes("سیل")) {
        tags.add("floodRisk");
    }
    if (combined.includes("protest") || combined.includes("dharna") || combined.includes("hartal") || combined.includes("sit-in") || combined.includes("احتجاج")) {
        tags.add("civilUnrest");
    }
    if (combined.includes("weather") || combined.includes("storm")) {
        tags.add("weather");
    }

    return Array.from(tags);
}

export function tagOverlapRatio(a: string[], b: string[]): number {
    const setA = new Set(a.map((t) => t.toLowerCase()));
    const setB = new Set(b.map((t) => t.toLowerCase()));
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const tag of setA) {
        if (setB.has(tag)) intersection += 1;
    }
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
}

export function summarySimilarity(a: string, b: string): number {
    const normalize = (value: string) =>
        value
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((token) => token.length > 2);

    const tokensA = new Set(normalize(a));
    const tokensB = new Set(normalize(b));
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const token of tokensA) {
        if (tokensB.has(token)) intersection += 1;
    }
    const union = new Set([...tokensA, ...tokensB]).size;
    return union === 0 ? 0 : intersection / union;
}

export { KNOWN_TAGS };
