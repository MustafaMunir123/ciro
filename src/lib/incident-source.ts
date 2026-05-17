import type { Incident, SourceTrailEntry } from "@/lib/types";

function isUserSubmittedTrailEntry(entry: unknown): boolean {
    if (entry === "USER_SUBMITTED") return true;
    if (!entry || typeof entry !== "object") return false;
    const dump = (entry as SourceTrailEntry).json_dump_response;
    if (dump && typeof dump === "object" && !Array.isArray(dump)) {
        return (dump as { source?: string }).source === "USER_SUBMITTED";
    }
    return false;
}

function sourceTrailHasUserSubmission(trail: unknown): boolean {
    return Array.isArray(trail) && trail.some(isUserSubmittedTrailEntry);
}

/** True when the incident came from a citizen/user report (not the automated intel pipeline). */
export function isUserSubmittedIncident(incident: Incident): boolean {
    if (incident.is_user_submitted === true) return true;
    if (incident.id?.startsWith("EVT-USER-")) return true;
    if (sourceTrailHasUserSubmission(incident.source_trail)) {
        return true;
    }
    const raw = incident.raw_input || "";
    if (raw.startsWith("{")) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed?.user_submission) return true;
        } catch {
            // ignore
        }
    }
    return false;
}

export function resolveIsUserSubmittedFromRow(row: {
    is_user_submitted?: boolean | null;
    event_id?: string | null;
    source_trail?: unknown;
    raw_input?: string | null;
}): boolean {
    if (row.is_user_submitted === true) return true;
    const id = row.event_id || "";
    if (String(id).startsWith("EVT-USER-")) return true;
    if (sourceTrailHasUserSubmission(row.source_trail)) return true;
    const raw = row.raw_input ?? "";
    if (typeof raw === "string" && raw.startsWith("{")) {
        try {
            if (JSON.parse(raw)?.user_submission) return true;
        } catch {
            // ignore
        }
    }
    return false;
}
