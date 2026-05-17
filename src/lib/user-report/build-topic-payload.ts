import type { DisasterIntelResponse } from "@/lib/data-fetching-layer";
import type { ParsedUserSubmission, UserSubmissionTopicPayload, UserTopicIntelEntry } from "./types";
import type { SourceTrailEntry } from "@/lib/types";

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

    const newsRecords = intelEntry.records.filter((record) => record.source === "NEWS_API");
    const socialRecords = intelEntry.records.filter((record) => record.source === "SOCIAL_API");
    const sourceTrail: SourceTrailEntry[] = [
        { type: "social", json_dump_response: { source: "USER_SUBMITTED" } },
    ];
    if (newsRecords.length > 0) {
        sourceTrail.push({ type: "news", json_dump_response: newsRecords });
    }
    if (socialRecords.length > 0) {
        sourceTrail.push({ type: "social", json_dump_response: socialRecords });
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
        source_trail: sourceTrail,
    };
}
