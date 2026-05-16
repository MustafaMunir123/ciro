import { NextResponse } from "next/server";
import { refreshAlertsCache } from "@/lib/social-media-fetch/service";
import type { AlertsResponse } from "@/lib/social-media-fetch/types";

export const runtime = "nodejs";

export async function GET() {
    const alerts = await refreshAlertsCache();

    const body: AlertsResponse = {
        count: alerts.length,
        alerts,
    };

    return NextResponse.json(body);
}
