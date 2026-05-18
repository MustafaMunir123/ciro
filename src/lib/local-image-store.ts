import { createHash } from "crypto";
import path from "path";
import { Storage } from "@google-cloud/storage";

const THUMBNAIL_TLS_INSECURE_FALLBACK = process.env.THUMBNAIL_TLS_INSECURE_FALLBACK !== "false";
const GCS_BUCKET_NAME = "curious-signal-488518-t5_cloudbuild";
const GCS_IMAGE_BASE_PATH = "images";
const GCP_SERVICE_KEY_JSON = process.env.GCP_SERVICE_KEY_JSON;

let storageClient: Storage | null = null;

function getStorageClient(): Storage {
    if (storageClient) return storageClient;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        storageClient = new Storage();
        return storageClient;
    }

    if (GCP_SERVICE_KEY_JSON) {
        try {
            const credentials = JSON.parse(GCP_SERVICE_KEY_JSON);
            storageClient = new Storage({ credentials });
            return storageClient;
        } catch (error) {
            throw new Error("Invalid GCP_SERVICE_KEY_JSON value. Ensure it is valid single-line JSON.");
        }
    }

    throw new Error("Missing GCP credentials. Set GCP_SERVICE_KEY_JSON (single-line JSON) or GOOGLE_APPLICATION_CREDENTIALS.");
}

function getErrorCode(error: any): string | undefined {
    return error?.code || error?.cause?.code;
}

function getExtFromContentType(contentType?: string | null): string {
    const clean = String(contentType || "").toLowerCase();
    if (clean.includes("image/png")) return ".png";
    if (clean.includes("image/webp")) return ".webp";
    if (clean.includes("image/gif")) return ".gif";
    if (clean.includes("image/heic") || clean.includes("image/heif")) return ".heic";
    if (clean.includes("image/jpeg") || clean.includes("image/jpg")) return ".jpg";
    return ".jpg";
}

function getExtFromUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        const ext = path.extname(parsed.pathname).toLowerCase();
        if ([".png", ".webp", ".gif", ".jpg", ".jpeg"].includes(ext)) {
            return ext === ".jpeg" ? ".jpg" : ext;
        }
    } catch {
        return null;
    }
    return null;
}

function sanitizeFileBaseName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildGcsPublicUrl(objectName: string): string {
    return `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${objectName}`;
}

function buildGcsObjectPath(sourceUrl: string, contentType?: string | null, preferredBaseName?: string): { objectName: string; publicUrl: string } {
    const digest = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
    const baseName = sanitizeFileBaseName(preferredBaseName || "") || digest;
    const extension = getExtFromUrl(sourceUrl) || getExtFromContentType(contentType);
    const objectName = `${GCS_IMAGE_BASE_PATH}/${baseName}/${baseName}${extension}`;
    return {
        objectName,
        publicUrl: buildGcsPublicUrl(objectName),
    };
}

async function fetchImageWithInsecureTls(url: string): Promise<Response> {
    const https = await import("https");
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: "GET", rejectUnauthorized: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => {
                const body = Buffer.concat(chunks);
                resolve(
                    new Response(body, {
                        status: res.statusCode || 500,
                        headers: { "content-type": String(res.headers["content-type"] || "application/octet-stream") },
                    }),
                );
            });
        });
        req.on("error", reject);
        req.end();
    });
}

export async function persistUploadBufferToLocalPath(
    buffer: Buffer,
    contentType: string,
    preferredBaseName?: string,
    extensionOverride?: string,
): Promise<string | undefined> {
    if (!buffer.length) return undefined;
    const cleanType = String(contentType || "").toLowerCase();
    if (!cleanType.startsWith("image/")) return undefined;

    const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
    const baseName = sanitizeFileBaseName(preferredBaseName || "") || digest;
    const extension = extensionOverride || getExtFromContentType(contentType);
    const objectName = `${GCS_IMAGE_BASE_PATH}/${baseName}/${baseName}${extension}`;

    const storage = getStorageClient();
    const bucket = storage.bucket(GCS_BUCKET_NAME);
    const file = bucket.file(objectName);
    await file.save(buffer, {
        resumable: false,
        metadata: {
            contentType,
            cacheControl: "public, max-age=31536000",
        },
    });
    return buildGcsPublicUrl(objectName);
}

export async function persistRemoteImageToLocalPath(imageUrl?: string, preferredBaseName?: string): Promise<string | undefined> {
    const cleanUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";
    if (!cleanUrl) return undefined;
    if (cleanUrl.startsWith("gs://") || cleanUrl.startsWith("https://storage.googleapis.com/")) return cleanUrl;

    let response: Response;
    try {
        response = await fetch(cleanUrl, { cache: "no-store" });
    } catch (error: any) {
        if (THUMBNAIL_TLS_INSECURE_FALLBACK && getErrorCode(error) === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
            response = await fetchImageWithInsecureTls(cleanUrl);
        } else {
            return undefined;
        }
    }

    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type");
    if (!String(contentType || "").toLowerCase().startsWith("image/")) {
        return undefined;
    }

    const { objectName, publicUrl } = buildGcsObjectPath(cleanUrl, contentType, preferredBaseName);

    const buffer = Buffer.from(await response.arrayBuffer());
    const storage = getStorageClient();
    const bucket = storage.bucket(GCS_BUCKET_NAME);
    const file = bucket.file(objectName);
    await file.save(buffer, {
        resumable: false,
        metadata: {
            contentType: contentType || "image/jpeg",
            cacheControl: "public, max-age=31536000",
        },
    });
    return publicUrl;
}
