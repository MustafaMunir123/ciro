import type { Incident } from "@/lib/types";

/** True when the incident came from a citizen/user report (not the automated intel pipeline). */
export function isUserSubmittedIncident(incident: Incident): boolean {
    if (incident.is_user_submitted === true) return true;
    if (incident.id?.startsWith("EVT-USER-")) return true;
    if (Array.isArray(incident.source_trail) && incident.source_trail.includes("USER_SUBMITTED")) {
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
    source_trail?: string[] | null;
    raw_input?: string | null;
}): boolean {
    if (row.is_user_submitted === true) return true;
    const id = row.event_id || "";
    if (String(id).startsWith("EVT-USER-")) return true;
    const trail = row.source_trail;
    if (Array.isArray(trail) && trail.includes("USER_SUBMITTED")) return true;
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
