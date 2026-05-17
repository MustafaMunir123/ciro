import { createHash } from "crypto";
import { mkdir, access, writeFile } from "fs/promises";
import path from "path";

const THUMBNAIL_DIR_NAME = "event-thumbnails";
const THUMBNAIL_PUBLIC_DIR = path.join(process.cwd(), "public", THUMBNAIL_DIR_NAME);
const THUMBNAIL_TLS_INSECURE_FALLBACK = process.env.THUMBNAIL_TLS_INSECURE_FALLBACK !== "false";

let thumbnailDirReady: Promise<void> | null = null;

function ensureThumbnailDir() {
    if (!thumbnailDirReady) {
        thumbnailDirReady = mkdir(THUMBNAIL_PUBLIC_DIR, { recursive: true }).then(() => undefined);
    }
    return thumbnailDirReady;
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

function buildLocalImagePath(sourceUrl: string, contentType?: string | null, preferredBaseName?: string): { absolutePath: string; relativePath: string } {
    const digest = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
    const baseName = sanitizeFileBaseName(preferredBaseName || "") || digest;
    const extension = getExtFromUrl(sourceUrl) || getExtFromContentType(contentType);
    const filename = `${baseName}${extension}`;
    return {
        absolutePath: path.join(THUMBNAIL_PUBLIC_DIR, filename),
        relativePath: `/${THUMBNAIL_DIR_NAME}/${filename}`,
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

    await ensureThumbnailDir();
    const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
    const baseName = sanitizeFileBaseName(preferredBaseName || "") || digest;
    const extension = extensionOverride || getExtFromContentType(contentType);
    const filename = `${baseName}${extension}`;
    const absolutePath = path.join(THUMBNAIL_PUBLIC_DIR, filename);
    const relativePath = `/${THUMBNAIL_DIR_NAME}/${filename}`;

    try {
        await access(absolutePath);
        return relativePath;
    } catch {
        // write new file
    }

    await writeFile(absolutePath, buffer);
    return relativePath;
}

export async function persistRemoteImageToLocalPath(imageUrl?: string, preferredBaseName?: string): Promise<string | undefined> {
    const cleanUrl = typeof imageUrl === "string" ? imageUrl.trim() : "";
    if (!cleanUrl) return undefined;
    if (cleanUrl.startsWith(`/${THUMBNAIL_DIR_NAME}/`)) return cleanUrl;

    await ensureThumbnailDir();

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

    const { absolutePath, relativePath } = buildLocalImagePath(cleanUrl, contentType, preferredBaseName);

    try {
        await access(absolutePath);
        return relativePath;
    } catch {
        // File does not exist; continue to write it.
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(absolutePath, buffer);
    return relativePath;
}
