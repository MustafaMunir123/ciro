const RETRY_DELAYS = [1000, 3000, 8000, 15000]; // Exponential backoff: 1s, 3s, 8s, 15s
const GEMINI_MAX_RPM = Math.max(
    1,
    Math.min(
        5,
        Number(process.env.GEMINI_MAX_RPM || process.env.NEXT_PUBLIC_GEMINI_MAX_RPM || 5)
    )
);
const GEMINI_MIN_INTERVAL_MS = Math.max(12000, Math.ceil(60000 / GEMINI_MAX_RPM));

let lastGeminiRequestAt = 0;
let limiterQueue: Promise<void> = Promise.resolve();
let geminiCooldownUntil = 0;
let hasLoggedGeminiCooldown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForGeminiRateLimitSlot() {
    const previous = limiterQueue;
    let release!: () => void;
    limiterQueue = new Promise<void>((resolve) => {
        release = resolve;
    });

    await previous;
    const now = Date.now();
    if (geminiCooldownUntil > now) {
        await sleep(geminiCooldownUntil - now);
    }
    const elapsed = now - lastGeminiRequestAt;
    const remaining = GEMINI_MIN_INTERVAL_MS - elapsed;
    if (remaining > 0) {
        await sleep(remaining);
    }
    lastGeminiRequestAt = Date.now();
    release();
}

function getErrorStatus(error: any): number | null {
    const direct = Number(error?.status || error?.code);
    if (Number.isFinite(direct)) return direct;
    const message = String(error?.message || "");
    const match = message.match(/"code"\s*:\s*(\d+)/) || message.match(/\bstatus:\s*(\d+)\b/i);
    if (match?.[1]) return Number(match[1]);
    return null;
}

function isQuotaError(error: any): boolean {
    const status = getErrorStatus(error);
    const message = String(error?.message || "").toUpperCase();
    return status === 429 || message.includes("RESOURCE_EXHAUSTED") || message.includes("QUOTA");
}

function markGlobalCooldown(error: any) {
    const retryDelayMs = extractRetryDelayMs(error, 0);
    geminiCooldownUntil = Date.now() + retryDelayMs;
    if (!hasLoggedGeminiCooldown) {
        console.warn(`[GEMINI-UTILS] Global cooldown enabled for ${Math.ceil(retryDelayMs / 1000)}s after quota/rate-limit.`);
        hasLoggedGeminiCooldown = true;
    }
}

/**
 * Checks if an error is a retryable 503 or Overloaded error.
 */
function isRetryableError(error: any): boolean {
    const status = error.status || error.code;
    const message = error.message || "";

    return (
        status === 429 ||
        status === 503 ||
        status === "UNAVAILABLE" ||
        status === "RESOURCE_EXHAUSTED" ||
        message.includes("429") ||
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("quota") ||
        message.includes("503") ||
        message.includes("Overloaded") ||
        message.includes("UNAVAILABLE") ||
        message.includes("overloaded")
    );
}

function extractRetryDelayMs(error: any, attempt: number): number {
    const message = String(error?.message || "");
    const retryInMatch = message.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
    if (retryInMatch?.[1]) {
        return Math.max(1000, Math.ceil(Number(retryInMatch[1]) * 1000));
    }

    const retryDelayMatch = message.match(/"retryDelay"\s*:\s*"([0-9]+)s"/i);
    if (retryDelayMatch?.[1]) {
        return Math.max(1000, Number(retryDelayMatch[1]) * 1000);
    }

    const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
    return delay ?? 15000;
}

/**
 * Wraps model.generateContent with retry logic for 503 errors.
 */
export async function generateContentWithRetry(
    model: any,
    request: any
): Promise<any> {
    let lastError: any;

    for (let i = 0; i <= RETRY_DELAYS.length; i++) {
        try {
            await waitForGeminiRateLimitSlot();
            return await model.generateContent(request);
        } catch (error: any) {
            lastError = error;
            if (isQuotaError(error)) {
                markGlobalCooldown(error);
                throw error;
            }
            if (isRetryableError(error)) {
                const retryDelayMs = extractRetryDelayMs(error, i);
                console.warn(`[GEMINI-UTILS] Gemini transient/quota error. Retrying in ${Math.ceil(retryDelayMs / 1000)}s... (Attempt ${i + 1}/${RETRY_DELAYS.length + 1})`);
                if (i < RETRY_DELAYS.length) {
                    await sleep(retryDelayMs);
                    continue;
                }
            }
            throw error; // Re-throw if not retryable or max retries reached
        }
    }
    throw lastError;
}

/**
 * Wraps model.generateContentStream with retry logic for 503 errors.
 */
export async function generateContentStreamWithRetry(
    model: any,
    request: any
): Promise<any> {
    let lastError: any;

    for (let i = 0; i <= RETRY_DELAYS.length; i++) {
        try {
            await waitForGeminiRateLimitSlot();
            return await model.generateContentStream(request);
        } catch (error: any) {
            lastError = error;
            if (isQuotaError(error)) {
                markGlobalCooldown(error);
                throw error;
            }
            if (isRetryableError(error)) {
                const retryDelayMs = extractRetryDelayMs(error, i);
                console.warn(`[GEMINI-UTILS] Gemini transient/quota error (stream). Retrying in ${Math.ceil(retryDelayMs / 1000)}s... (Attempt ${i + 1}/${RETRY_DELAYS.length + 1})`);
                if (i < RETRY_DELAYS.length) {
                    await sleep(retryDelayMs);
                    continue;
                }
            }
            throw error;
        }
    }
    throw lastError;
}
/**
 * Robustly extracts and parses JSON from a string that may contain 
 * multiple JSON objects or surrounding text/markdown.
 */
export function extractAndParseJSON(text: string) {
    if (!text || !text.trim()) {
        throw new Error("Empty text provided for JSON parsing");
    }

    // 1. Try simple parse first
    try {
        return JSON.parse(text);
    } catch (e) {
        // Continue to more robust methods
    }

    // 2. Remove markdown code blocks and whitespace
    let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Continue
    }

    // 3. Find all potential JSON objects using brace matching (handles nested objects)
    const jsonObjects: string[] = [];
    let braceCount = 0;
    let startPos = -1;

    for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') {
            if (braceCount === 0) startPos = i;
            braceCount++;
        } else if (cleaned[i] === '}') {
            braceCount--;
            if (braceCount === 0 && startPos !== -1) {
                jsonObjects.push(cleaned.substring(startPos, i + 1));
                startPos = -1;
            }
        }
    }

    // 4. Try parsing each object, starting from the last one (often the most complete/final)
    for (let i = jsonObjects.length - 1; i >= 0; i--) {
        const candidate = jsonObjects[i];
        try {
            return JSON.parse(candidate);
        } catch (e) {
            // 5. Final attempt: sanitize control characters that break JSON.parse (like literal newlines)
            try {
                const sanitized = candidate.replace(/[\x00-\x1F]/g, (match) => {
                    if (match === '\n') return '\\n';
                    if (match === '\r') return '\\r';
                    if (match === '\t') return '\\t';
                    return '';
                });
                return JSON.parse(sanitized);
            } catch (innerE) {
                // Try next block
            }
        }
    }

    console.error("[GEMINI-UTILS] Failed to extract valid JSON from:", text);
    throw new Error("No valid JSON object found in response");
}
