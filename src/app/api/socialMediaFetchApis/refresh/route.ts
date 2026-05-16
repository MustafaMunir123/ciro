import { NextResponse } from "next/server";
import { refreshAlertsCache } from "@/lib/social-media-fetch/service";
import type { RefreshResponse } from "@/lib/social-media-fetch/types";

export const runtime = "nodejs";

export async function GET() {
    const alerts = await refreshAlertsCache();

    const body: RefreshResponse = {
        status: "refreshed",
        count: alerts.length,
    };

    return NextResponse.json(body);
}
