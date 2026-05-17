import { Type } from "@google/genai";
import { ai } from "@/lib/gemini-client";
import { MODELS } from "@/lib/constants";
import { extractAndParseJSON, generateContentWithRetry } from "@/lib/gemini-utils";

type EnrichmentInput = {
    ai_summary?: string | null;
    category?: string | null;
    city?: string | null;
    area?: string | null;
    event_tags?: string[] | null;
    mission_context?: string | null;
    raw_input?: string | null;
};

const MAX_PRECAUTIONS = 6;
const ENRICHMENT_MAX_RPM = Math.max(1, Math.min(4, Number(process.env.NEXT_PUBLIC_GEMINI_MAX_RPM || 4)));
const ENRICHMENT_MIN_INTERVAL_MS = Math.max(15000, Math.ceil(60000 / ENRICHMENT_MAX_RPM));
let lastEnrichmentRequestAt = 0;
let enrichmentCooldownUntil = 0;
let hasLoggedEnrichmentQuotaCooldown = false;

function compact(text: string | null | undefined): string {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function isWeakSummary(summary: string): boolean {
    if (!summary) return true;
    if (summary.length < 90) return true;
    const lower = summary.toLowerCase();
    if (lower.startsWith("topic signal generated for")) return true;
    if (lower.startsWith("signal generated for")) return true;
    return false;
}

function buildDeterministicSummary(input: EnrichmentInput): string {
    const category = compact(input.category) || "Incident";
    const city = compact(input.city) || "Unknown city";
    const area = compact(input.area) || "Unknown area";
    const existing = compact(input.ai_summary);
    if (existing && !isWeakSummary(existing)) return existing.slice(0, 1000);
    const mission = compact(input.mission_context);
    const context = mission ? ` ${mission}` : "";
    return `${category} reported in ${area}, ${city}.${context}`.slice(0, 1000);
}

function buildDeterministicPrecautions(input: EnrichmentInput, summary: string): string[] {
    const tags = Array.isArray(input.event_tags) ? input.event_tags.map((v) => String(v).toLowerCase()) : [];
    const haystack = `${summary} ${input.category || ""} ${tags.join(" ")}`.toLowerCase();
    const out: string[] = [];

    out.push("Avoid rumor sharing and follow official city emergency advisories.");
    if (haystack.includes("fire")) {
        out.push("Keep clear of the immediate blast/smoke radius and avoid enclosed smoke zones.");
        out.push("Switch off nearby gas/electrical mains only if safe to do so.");
    }
    if (haystack.includes("flood") || haystack.includes("rain") || haystack.includes("water")) {
        out.push("Do not drive through standing water; use alternate higher routes.");
        out.push("Avoid contact with submerged electrical infrastructure and downed lines.");
    }
    if (haystack.includes("road") || haystack.includes("gridlock") || haystack.includes("closure") || haystack.includes("block")) {
        out.push("Expect route diversions and keep emergency lanes unobstructed.");
        out.push("Use verified traffic channels before dispatching field teams.");
    }
    if (haystack.includes("protest") || haystack.includes("civil") || haystack.includes("unrest")) {
        out.push("Avoid crowd convergence points and maintain safe perimeter movement.");
    }
    if (haystack.includes("weather")) {
        out.push("Secure loose outdoor objects and monitor short-window weather alerts.");
    }

    const unique = Array.from(new Set(out.map((v) => compact(v)).filter(Boolean)));
    return unique.slice(0, MAX_PRECAUTIONS);
}

function buildPromptContext(input: EnrichmentInput, summarySeed: string): string {
    const rawSlice = compact(input.raw_input).slice(0, 2000);
    return [
        `Category: ${compact(input.category) || "Unknown"}`,
        `City: ${compact(input.city) || "Unknown"}`,
        `Area: ${compact(input.area) || "Unknown"}`,
        `Event tags: ${(input.event_tags || []).join(", ") || "None"}`,
        `Existing ai_summary: ${summarySeed || "None"}`,
        `Mission context: ${compact(input.mission_context) || "None"}`,
        `Raw input (truncated): ${rawSlice || "None"}`,
    ].join("\n");
}

function normalizePrecautions(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const cleaned = value
        .map((item) => compact(String(item || "")))
        .filter(Boolean)
        .map((item) => item.endsWith(".") ? item : `${item}.`);
    return Array.from(new Set(cleaned)).slice(0, MAX_PRECAUTIONS);
}

function nowMs(): number {
    return Date.now();
}

function getErrorStatus(error: any): number | null {
    const direct = Number(error?.status || error?.code);
    if (Number.isFinite(direct)) return direct;
    const message = String(error?.message || "");
    const match = message.match(/"code"\s*:\s*(\d+)/) || message.match(/\bstatus:\s*(\d+)\b/i);
    if (match?.[1]) return Number(match[1]);
    return null;
}

function parseRetryDelayMs(error: any): number {
    const message = String(error?.message || "");
    const explicit = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
    if (explicit?.[1]) {
        return Math.max(1000, Math.ceil(Number(explicit[1]) * 1000));
    }
    const retryInfo = message.match(/"retryDelay"\s*:\s*"([0-9]+)s"/i);
    if (retryInfo?.[1]) {
        return Math.max(1000, Number(retryInfo[1]) * 1000);
    }
    return 60000;
}

function shouldSkipGeminiForQuota(): boolean {
    const now = nowMs();
    if (now < enrichmentCooldownUntil) return true;
    if (now - lastEnrichmentRequestAt < ENRICHMENT_MIN_INTERVAL_MS) return true;
    return false;
}

export async function generateEventSummaryAndPrecautions(input: EnrichmentInput): Promise<{
    ai_summary: string;
    precautions: string[];
}> {
    const deterministicSummary = buildDeterministicSummary(input);
    const deterministicPrecautions = buildDeterministicPrecautions(input, deterministicSummary);

    if (!process.env.GEMINI_API_KEY) {
        return {
            ai_summary: deterministicSummary,
            precautions: deterministicPrecautions,
        };
    }
    if (shouldSkipGeminiForQuota()) {
        return {
            ai_summary: deterministicSummary,
            precautions: deterministicPrecautions,
        };
    }

    const prompt = buildPromptContext(input, deterministicSummary);
    const systemInstruction = `You generate concise emergency intelligence enrichment.
Return strict JSON only.
Rules:
- ai_summary: 2-3 sentences, concrete, no fluff, max 550 chars.
- precautions: array of 4-6 short actionable precautions.
- Precautions must be operational actions, each item plain string.
- Use available context only; do not invent unsupported claims.
- Keep language clear for public safety + responder dispatch teams.`;

    try {
        lastEnrichmentRequestAt = nowMs();
        const response = await generateContentWithRetry(ai.models, {
            model: MODELS.TRIAGE,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        ai_summary: { type: Type.STRING },
                        precautions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ["ai_summary", "precautions"],
                },
            },
        });

        const rawText =
            (typeof response.text === "function" ? response.text() : null) ||
            response.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ||
            "{}";
        const parsed = extractAndParseJSON(rawText);

        const aiSummary = compact(parsed?.ai_summary || deterministicSummary).slice(0, 1000) || deterministicSummary;
        const precautions = normalizePrecautions(parsed?.precautions);
        return {
            ai_summary: aiSummary || deterministicSummary,
            precautions: precautions.length > 0 ? precautions : deterministicPrecautions,
        };
    } catch (error) {
        const status = getErrorStatus(error);
        if (status === 429) {
            const retryDelay = parseRetryDelayMs(error);
            enrichmentCooldownUntil = nowMs() + retryDelay;
            if (!hasLoggedEnrichmentQuotaCooldown) {
                console.warn(`[event-ai-enrichment] Gemini quota hit (429). Using deterministic fallback until cooldown expires (${Math.ceil(retryDelay / 1000)}s).`);
                hasLoggedEnrichmentQuotaCooldown = true;
            }
        } else {
            console.warn("[event-ai-enrichment] Gemini enrichment unavailable. Using deterministic fallback.");
        }
        return {
            ai_summary: deterministicSummary,
            precautions: deterministicPrecautions,
        };
    }
}
