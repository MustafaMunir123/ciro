import { NextRequest, NextResponse } from "next/server";
import { fetchDisasterIntel } from "@/lib/data-fetching-layer";
import { persistUploadBufferToLocalPath } from "@/lib/local-image-store";
import { ImageValidationError, validateUserImageUpload } from "@/lib/image-upload-validation";
import { parseUserSubmission } from "@/lib/user-report/parse-submission";
import { checkDuplicateSubmission } from "@/lib/user-report/dedupe";
import { buildTopicPayload } from "@/lib/user-report/build-topic-payload";
import { buildEventId, buildUserIncident, upsertUserScanEvent } from "@/lib/user-report/store-submission";
import type { UserReportSubmitResponse } from "@/lib/user-report/types";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 4000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function parseCoordinate(value: FormDataEntryValue | null, field: string): number {
    const num = Number(typeof value === "string" ? value.trim() : "");
    if (!Number.isFinite(num)) {
        throw new Error(`Missing or invalid ${field}`);
    }
    return num;
}

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const textEntry = form.get("text");
        const text = typeof textEntry === "string" ? textEntry.trim() : "";
        if (!text) {
            return NextResponse.json({ error: "Missing required field: text" }, { status: 400 });
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return NextResponse.json({ error: `text exceeds ${MAX_TEXT_LENGTH} characters` }, { status: 400 });
        }

        const lat = parseCoordinate(form.get("lat"), "lat");
        const lng = parseCoordinate(form.get("lng"), "lng");
        const city = typeof form.get("city") === "string" ? String(form.get("city")).trim() : "";
        const area = typeof form.get("area") === "string" ? String(form.get("area")).trim() : "";

        const photo = form.get("photo") ?? form.get("image");
        let photoBuffer: Buffer | null = null;
        let photoContentType: string | null = null;
        let photoExtension: string | undefined;
        if (photo instanceof File && photo.size > 0) {
            try {
                const validated = await validateUserImageUpload(photo, MAX_IMAGE_BYTES);
                photoBuffer = validated.buffer;
                photoContentType = validated.contentType;
                photoExtension = validated.extension;
            } catch (validationError) {
                const message =
                    validationError instanceof ImageValidationError
                        ? validationError.message
                        : "Invalid image upload";
                return NextResponse.json({ error: message }, { status: 400 });
            }
        }

        const parsed = await parseUserSubmission({ text, lat, lng, city: city || undefined, area: area || undefined });

        const intel = await fetchDisasterIntel({
            query: parsed.intel_search_query,
            city: parsed.city,
            area: parsed.area,
            topic: parsed.topic,
            language: parsed.language === "ur" ? "ur" : "en",
        });

        const topicPayload = buildTopicPayload({
            parsed,
            text,
            lat,
            lng,
            intel,
        });

        const dedupe = await checkDuplicateSubmission(parsed, lat, lng);

        if (dedupe.is_duplicate) {
            const body: UserReportSubmitResponse = {
                status: "duplicate",
                parsed,
                intel,
                topic_payload: topicPayload,
                dedupe,
            };
            return NextResponse.json(body);
        }

        const eventId = buildEventId();
        let thumbnailPath: string | undefined;
        if (photoBuffer && photoContentType) {
            thumbnailPath = await persistUploadBufferToLocalPath(
                photoBuffer,
                photoContentType,
                eventId,
                photoExtension,
            );
        }

        const incident = buildUserIncident({
            eventId,
            parsed,
            text,
            lat,
            lng,
            topicPayload,
            thumbnailPath,
            address: `${parsed.place}, ${parsed.area}, ${parsed.city}`,
        });

        const stored = await upsertUserScanEvent(incident, { city: parsed.city, area: parsed.area });

        const body: UserReportSubmitResponse = {
            status: "stored",
            parsed,
            intel,
            topic_payload: topicPayload,
            dedupe,
            event: {
                event_id: stored.event_id,
                is_user_submitted: true,
            },
        };

        return NextResponse.json(body, { status: 201 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "User report submit failed";
        console.error("[USER-REPORTS][POST]", error);
        return NextResponse.json({ status: "error", error: message }, { status: 500 });
    }
}
