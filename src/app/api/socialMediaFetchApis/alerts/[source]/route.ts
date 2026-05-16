import { NextRequest, NextResponse } from "next/server";
import { fetchAlertsBySource } from "@/lib/social-media-fetch/service";
import { isAlertSourceName } from "@/lib/social-media-fetch/sources";
import type { AlertsResponse } from "@/lib/social-media-fetch/types";

export const runtime = "nodejs";

interface RouteContext {
    params: Promise<{ source: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
    const { source } = await context.params;

    if (!isAlertSourceName(source)) {
        return NextResponse.json(
            { error: `Invalid source. Expected one of: twitter, reddit, facebook, googleNews` },
            { status: 400 },
        );
    }

    const alerts = await fetchAlertsBySource(source);

    const body: AlertsResponse = {
        count: alerts.length,
        alerts,
    };

    return NextResponse.json(body);
}
