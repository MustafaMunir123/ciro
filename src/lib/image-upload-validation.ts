export type DetectedImageFormat = "jpeg" | "png" | "webp" | "heic";

export interface ValidatedUserImage {
    buffer: Buffer;
    contentType: string;
    format: DetectedImageFormat;
    extension: string;
}

const ALLOWED_MIMES = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
    "image/pjpeg",
]);

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

function startsWithBytes(buffer: Buffer, offset: number, signature: number[]): boolean {
    if (buffer.length < offset + signature.length) return false;
    return signature.every((byte, index) => buffer[offset + index] === byte);
}

function readAscii(buffer: Buffer, start: number, length: number): string {
    return buffer.toString("ascii", start, start + length);
}

/**
 * Detect real image format from file magic bytes (not trusting client MIME alone).
 */
export function detectImageFormat(buffer: Buffer): DetectedImageFormat | null {
    if (buffer.length < 12) return null;

    // JPEG: FF D8 FF
    if (startsWithBytes(buffer, 0, [0xff, 0xd8, 0xff])) {
        return "jpeg";
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (startsWithBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return "png";
    }

    // WebP: RIFF....WEBP
    if (
        buffer.length >= 12 &&
        readAscii(buffer, 0, 4) === "RIFF" &&
        readAscii(buffer, 8, 4) === "WEBP"
    ) {
        return "webp";
    }

    // HEIC / HEIF (iPhone): ISO BMFF with ftyp brand heic, heif, mif1, etc.
    if (readAscii(buffer, 4, 4) === "ftyp") {
        const brand = readAscii(buffer, 8, 4).toLowerCase();
        const heicBrands = new Set(["heic", "heif", "heix", "hevc", "hevx", "mif1", "msf1", "avif"]);
        if (heicBrands.has(brand)) {
            return "heic";
        }
    }

    return null;
}

function formatToMime(format: DetectedImageFormat): string {
    switch (format) {
        case "jpeg":
            return "image/jpeg";
        case "png":
            return "image/png";
        case "webp":
            return "image/webp";
        case "heic":
            return "image/heic";
        default:
            return "application/octet-stream";
    }
}

function formatToExtension(format: DetectedImageFormat): string {
    switch (format) {
        case "jpeg":
            return ".jpg";
        case "png":
            return ".png";
        case "webp":
            return ".webp";
        case "heic":
            return ".heic";
        default:
            return ".bin";
    }
}

function isAllowedDeclaredMime(mime: string): boolean {
    if (!mime) return true;
    const clean = mime.toLowerCase().split(";")[0].trim();
    return ALLOWED_MIMES.has(clean);
}

function isAllowedFilename(name: string): boolean {
    const ext = pathExtname(name);
    return ext ? ALLOWED_EXTENSIONS.has(ext) : true;
}

function pathExtname(filename: string): string {
    const lower = filename.toLowerCase();
    const dot = lower.lastIndexOf(".");
    if (dot < 0) return "";
    return lower.slice(dot);
}

export class ImageValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ImageValidationError";
    }
}

/**
 * Validates a user-uploaded image file: size, declared type, extension hint, and magic bytes.
 */
export async function validateUserImageUpload(
    file: File,
    maxBytes: number,
): Promise<ValidatedUserImage> {
    if (file.size <= 0) {
        throw new ImageValidationError("Empty image file");
    }
    if (file.size > maxBytes) {
        throw new ImageValidationError(`Image exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`);
    }

    const declaredMime = (file.type || "").toLowerCase().split(";")[0].trim();
    if (declaredMime && !declaredMime.startsWith("image/")) {
        throw new ImageValidationError("Uploaded file is not an image");
    }
    if (declaredMime && !isAllowedDeclaredMime(declaredMime)) {
        throw new ImageValidationError(
            "Unsupported image type. Allowed: JPEG, PNG, WebP, or iPhone HEIC/HEIF.",
        );
    }
    if (file.name && !isAllowedFilename(file.name)) {
        throw new ImageValidationError(
            "Unsupported image file extension. Allowed: .jpg, .jpeg, .png, .webp, .heic, .heif",
        );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectImageFormat(buffer);
    if (!detected) {
        throw new ImageValidationError(
            "File is not a valid image. Allowed formats: JPEG, PNG, WebP, or iPhone HEIC/HEIF.",
        );
    }

    return {
        buffer,
        format: detected,
        contentType: formatToMime(detected),
        extension: formatToExtension(detected),
    };
}
