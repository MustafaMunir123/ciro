import type { DisasterIntelResponse } from "@/lib/data-fetching-layer";
import type { ParsedUserSubmission, UserSubmissionTopicPayload, UserTopicIntelEntry } from "./types";

export function buildTopicPayload(input: {
    parsed: ParsedUserSubmission;
    text: string;
    lat: number;
    lng: number;
    intel: DisasterIntelResponse;
    areaLat?: number;
    areaLng?: number;
}): UserSubmissionTopicPayload {
    const { parsed, text, lat, lng, intel } = input;
    const areaLat = input.areaLat ?? lat;
    const areaLng = input.areaLng ?? lng;

    const intelEntry: UserTopicIntelEntry = {
        topic: parsed.topic,
        place: parsed.place,
        records: (intel.results || []).slice(0, 3).map((record) => ({
            source: record.source,
            headline: record.title,
            url: record.url,
            published_at: record.published_at,
            tags: record.tags,
            thumbnail: record.thumbnail,
        })),
    };

    const sourceTrail = new Set<string>(["USER_SUBMITTED"]);
    for (const record of intelEntry.records) {
        if (record.source) sourceTrail.add(record.source);
    }

    return {
        city: parsed.city,
        areas: [
            {
                name: parsed.area,
                lat: areaLat,
                lng: areaLng,
                topics: [{ topic: parsed.topic, place: parsed.place }],
            },
        ],
        user_submission: {
            summary_en: parsed.summary_en,
            summary_original: parsed.summary_original,
            language: parsed.language,
            coordinates: { lat, lng },
            original_text: text,
        },
        intel_by_topic: [intelEntry],
        event_tags: parsed.event_tags,
        source_trail: Array.from(sourceTrail),
    };
}
