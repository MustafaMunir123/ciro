import { fetchNearbyScanEvents } from "./nearby-events";
import { summarySimilarity, tagOverlapRatio } from "./tag-utils";
import type { DedupeResult, ParsedUserSubmission } from "./types";

const DEFAULT_RADIUS_KM = 0.5;
const TAG_OVERLAP_THRESHOLD = 0.5;
const SUMMARY_SIMILARITY_THRESHOLD = 0.55;
const MIN_SHARED_TAGS = 2;

export async function checkDuplicateSubmission(
    parsed: ParsedUserSubmission,
    lat: number,
    lng: number,
    radiusKm = DEFAULT_RADIUS_KM,
): Promise<DedupeResult> {
    const nearby = await fetchNearbyScanEvents({
        lat,
        lng,
        city: parsed.city,
        radiusKm,
        limit: 100,
    });

    const summary = parsed.summary_en;
    const tags = parsed.event_tags;

    for (const candidate of nearby) {
        const candidateTags = Array.isArray(candidate.event_tags) ? candidate.event_tags : [];
        const candidateSummary = candidate.ai_summary || candidate.category || "";
        const tagScore = tagOverlapRatio(tags, candidateTags);
        const sharedTagCount = tags.filter((t) =>
            candidateTags.some((ct) => ct.toLowerCase() === t.toLowerCase()),
        ).length;
        const textScore = summarySimilarity(summary, candidateSummary);

        const geoMatch = (candidate.distance_km ?? Infinity) <= radiusKm;
        const tagMatch = tagScore >= TAG_OVERLAP_THRESHOLD || sharedTagCount >= MIN_SHARED_TAGS;
        const summaryMatch = textScore >= SUMMARY_SIMILARITY_THRESHOLD;

        if (geoMatch && tagMatch && summaryMatch) {
            return {
                is_duplicate: true,
                matched_event_id: candidate.event_id,
                reason: `Duplicate within ${radiusKm}km (tags=${tagScore.toFixed(2)}, summary=${textScore.toFixed(2)})`,
                checked_nearby_count: nearby.length,
            };
        }
    }

    return {
        is_duplicate: false,
        matched_event_id: null,
        reason: null,
        checked_nearby_count: nearby.length,
    };
}
