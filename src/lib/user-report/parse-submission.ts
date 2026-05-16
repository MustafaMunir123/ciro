import { ai } from "@/lib/gemini-client";
import { MODELS } from "@/lib/constants";
import { generateContentWithRetry, extractAndParseJSON } from "@/lib/gemini-utils";
import { Type } from "@google/genai";
import { enrichEventTagsFromText } from "./tag-utils";
import type { ParsedUserSubmission, ReportLanguage } from "./types";

function detectLanguageFallback(text: string): ReportLanguage {
    const urduPattern = /[\u0600-\u06FF]/;
    const hasUrdu = urduPattern.test(text);
    const hasLatin = /[a-zA-Z]/.test(text);
    if (hasUrdu && hasLatin) return "mixed";
    if (hasUrdu) return "ur";
    return "en";
}

function parseFallback(text: string, lat: number, lng: number, city?: string, area?: string): ParsedUserSubmission {
    const language = detectLanguageFallback(text);
    const summary = text.trim().slice(0, 500);
    const tags = enrichEventTagsFromText(text);

    return {
        language,
        summary_en: language === "ur" ? summary : summary,
        summary_original: summary,
        topic: summary.slice(0, 120) || "User reported incident",
        place: `${area || "Unknown area"}, ${city || "Karachi"}`,
        city: city || "Karachi",
        area: area || "Unknown",
        event_tags: tags,
        intel_search_query: `${summary} ${city || "Karachi"} ${area || ""}`.trim(),
    };
}

export async function parseUserSubmission(input: {
    text: string;
    lat: number;
    lng: number;
    city?: string;
    area?: string;
}): Promise<ParsedUserSubmission> {
    const text = input.text.trim();
    if (!text) {
        throw new Error("Report text is required");
    }

    if (!process.env.GEMINI_API_KEY) {
        return parseFallback(text, input.lat, input.lng, input.city, input.area);
    }

    const systemInstruction = `You parse citizen disaster reports for Karachi/Pakistan emergency ops.
The user text may be English, Urdu, or mixed. Do NOT invent facts.
Return concise structured JSON only.`;

    const prompt = `User report text:
"""
${text}
"""

Coordinates: lat=${input.lat}, lng=${input.lng}
Hints: city=${input.city || "unknown"}, area=${input.area || "unknown"}

Tasks:
1. Detect language: en | ur | mixed
2. summary_en: short English summary (max 280 chars)
3. summary_original: same meaning in user's language (or English if already English)
4. topic: one incident headline (like a news topic title)
5. place: best place string for geosearch
6. city and area: infer when possible (default Karachi if unclear)
7. event_tags: choose from roadblockage, fireHazard, floodRisk, civilUnrest, weather (only relevant ones)
8. intel_search_query: English search query for news APIs`;

    try {
        const response = await generateContentWithRetry(ai.models, {
            model: MODELS.TRIAGE,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        language: { type: Type.STRING },
                        summary_en: { type: Type.STRING },
                        summary_original: { type: Type.STRING },
                        topic: { type: Type.STRING },
                        place: { type: Type.STRING },
                        city: { type: Type.STRING },
                        area: { type: Type.STRING },
                        event_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        intel_search_query: { type: Type.STRING },
                    },
                    required: ["language", "summary_en", "summary_original", "topic", "place", "city", "area", "intel_search_query"],
                },
            },
        });

        const rawText =
            (typeof response.text === "function" ? response.text() : null) ||
            response.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ||
            "{}";

        const parsed = extractAndParseJSON(rawText);
        const languageRaw = String(parsed.language || "en").toLowerCase();
        const language: ReportLanguage =
            languageRaw === "ur" || languageRaw === "mixed" ? (languageRaw as ReportLanguage) : "en";

        const eventTags = enrichEventTagsFromText(
            `${parsed.topic || ""} ${parsed.summary_en || ""} ${text}`,
            Array.isArray(parsed.event_tags) ? parsed.event_tags.map(String) : [],
        );

        return {
            language,
            summary_en: String(parsed.summary_en || text).trim().slice(0, 1000),
            summary_original: String(parsed.summary_original || text).trim().slice(0, 1000),
            topic: String(parsed.topic || "User reported incident").trim(),
            place: String(parsed.place || input.area || "Karachi").trim(),
            city: String(parsed.city || input.city || "Karachi").trim(),
            area: String(parsed.area || input.area || "Unknown").trim(),
            event_tags: eventTags,
            intel_search_query: String(parsed.intel_search_query || `${parsed.topic} ${parsed.city}`).trim(),
        };
    } catch (error) {
        console.warn("[user-report] Gemini parse failed, using fallback:", error);
        return parseFallback(text, input.lat, input.lng, input.city, input.area);
    }
}
