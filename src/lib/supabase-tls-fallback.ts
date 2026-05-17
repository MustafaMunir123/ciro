let hasLoggedSupabaseTlsFallback = false;

const SUPABASE_TLS_INSECURE_FALLBACK = process.env.SUPABASE_TLS_INSECURE_FALLBACK !== "false";

export function getSupabaseRestConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    return { url, key };
}

function getErrorCode(error: any): string | undefined {
    return error?.code || error?.cause?.code;
}

export function shouldUseSupabaseTlsFallback(error: any): boolean {
    if (!SUPABASE_TLS_INSECURE_FALLBACK) return false;
    const errorCode = getErrorCode(error);
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return (
        errorCode === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
        message.includes("fetch failed") ||
        details.includes("unable to get local issuer certificate")
    );
}

export function logSupabaseTlsFallbackOnce(scope: string) {
    if (!hasLoggedSupabaseTlsFallback) {
        console.warn(`[SUPABASE][${scope}] TLS certificate chain not trusted. Using insecure TLS fallback for this environment.`);
        hasLoggedSupabaseTlsFallback = true;
    }
}

export async function fetchWithInsecureTls(url: string, init: RequestInit): Promise<Response> {
    const https = await import("https");
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                method: init.method || "GET",
                headers: init.headers as Record<string, string>,
                rejectUnauthorized: false,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on("end", () => {
                    const responseBody = Buffer.concat(chunks);
                    resolve(
                        new Response(responseBody, {
                            status: res.statusCode || 500,
                            headers: res.headers as Record<string, string>,
                        })
                    );
                });
            }
        );
        request.on("error", reject);
        if (init.body) request.write(init.body as string);
        request.end();
    });
}
