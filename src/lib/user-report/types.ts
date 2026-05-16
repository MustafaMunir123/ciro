import type { DisasterIntelResponse } from "@/lib/data-fetching-layer";

export type ReportLanguage = "en" | "ur" | "mixed";

export interface ParsedUserSubmission {
    language: ReportLanguage;
    summary_en: string;
    summary_original: string;
    topic: string;
    place: string;
    city: string;
    area: string;
    event_tags: string[];
    intel_search_query: string;
}

export interface UserTopicRecord {
    source: string;
    headline: string;
    url?: string;
    published_at?: string;
    tags?: string[];
    thumbnail?: string;
}

export interface UserTopicIntelEntry {
    topic: string;
    place?: string;
    records: UserTopicRecord[];
    fallback?: string;
}

export interface UserSubmissionTopicPayload {
    city: string;
    areas: Array<{
        name: string;
        lat: number;
        lng: number;
        topics: Array<{ topic: string; place?: string }>;
    }>;
    user_submission: {
        summary_en: string;
        summary_original: string;
        language: ReportLanguage;
        coordinates: { lat: number; lng: number };
        original_text: string;
    };
    intel_by_topic: UserTopicIntelEntry[];
    event_tags: string[];
    source_trail: string[];
}

export interface DedupeResult {
    is_duplicate: boolean;
    matched_event_id: string | null;
    reason: string | null;
    checked_nearby_count: number;
}

export interface UserReportSubmitResponse {
    status: "stored" | "duplicate" | "error";
    parsed: ParsedUserSubmission;
    intel: DisasterIntelResponse;
    topic_payload: UserSubmissionTopicPayload;
    dedupe: DedupeResult;
    event?: { event_id: string; is_user_submitted: boolean };
    error?: string;
}

export interface NearbyScanEvent {
    event_id: string;
    lat: number | null;
    lng: number | null;
    event_tags: string[] | null;
    ai_summary: string | null;
    category: string | null;
    city: string | null;
    area: string | null;
    is_user_submitted?: boolean | null;
    distance_km?: number;
}
