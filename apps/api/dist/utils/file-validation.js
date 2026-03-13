"use strict";
// ============================================================
// OrgsLedger API — File Upload Validation Utilities
// Magic-bytes verification and path traversal protection.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMagicBytes = verifyMagicBytes;
exports.sanitizeFilename = sanitizeFilename;
exports.validateMimeExtension = validateMimeExtension;
const fs_1 = __importDefault(require("fs"));
// ── Magic Bytes Signatures ──────────────────────────────────
// Maps MIME types to their expected file header bytes.
const MAGIC_BYTES = {
    'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
    'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])], // JFIF/EXIF
    'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47])], // .PNG
    'image/gif': [Buffer.from([0x47, 0x49, 0x46, 0x38])], // GIF8
    'image/webp': [Buffer.from('RIFF')], // RIFF....WEBP
    'application/zip': [Buffer.from([0x50, 0x4B, 0x03, 0x04])], // PK.. (also docx/xlsx/pptx)
    // Office Open XML files are ZIP archives internally
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': [Buffer.from([0x50, 0x4B, 0x03, 0x04])],
    // Legacy Office formats (OLE2 Compound Document)
    'application/msword': [Buffer.from([0xD0, 0xCF, 0x11, 0xE0])],
    'application/vnd.ms-excel': [Buffer.from([0xD0, 0xCF, 0x11, 0xE0])],
    'application/vnd.ms-powerpoint': [Buffer.from([0xD0, 0xCF, 0x11, 0xE0])],
};
/**
 * Verify file content matches its claimed MIME type by checking magic bytes.
 * Returns true if the file signature matches or if no signature is defined
 * for the given MIME type (text files, CSV, etc.).
 */
function verifyMagicBytes(filePath, claimedMime) {
    const signatures = MAGIC_BYTES[claimedMime];
    if (!signatures) {
        // No signature check available for this MIME type — allow it
        // (text/plain, text/csv don't have reliable magic bytes)
        return true;
    }
    try {
        const fd = fs_1.default.openSync(filePath, 'r');
        const headerBuf = Buffer.alloc(8);
        fs_1.default.readSync(fd, headerBuf, 0, 8, 0);
        fs_1.default.closeSync(fd);
        return signatures.some((sig) => {
            const slice = headerBuf.subarray(0, sig.length);
            return slice.equals(sig);
        });
    }
    catch {
        return false;
    }
}
/**
 * Sanitize a filename to prevent path traversal attacks.
 * Strips directory components, null bytes, and dangerous characters.
 */
function sanitizeFilename(filename) {
    // Remove null bytes
    let clean = filename.replace(/\0/g, '');
    // Extract only the filename part (strip any directory components)
    clean = clean.replace(/^.*[\\/]/, '');
    // Remove leading dots (prevents hidden files and .. traversal)
    clean = clean.replace(/^\.+/, '');
    // Remove control characters and problematic symbols
    clean = clean.replace(/[<>:"|?*\x00-\x1F]/g, '_');
    // Ensure we have a valid filename
    if (!clean || clean === '.' || clean === '..') {
        clean = 'unnamed_file';
    }
    // Limit length
    if (clean.length > 255) {
        const ext = clean.slice(clean.lastIndexOf('.'));
        clean = clean.slice(0, 255 - ext.length) + ext;
    }
    return clean;
}
/**
 * Check if file extension matches claimed MIME type.
 * Returns true for valid combinations.
 */
const MIME_EXT_MAP = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'application/vnd.ms-powerpoint': ['.ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    'text/plain': ['.txt', '.text', '.log', '.md'],
    'text/csv': ['.csv'],
};
function validateMimeExtension(filename, mime) {
    const allowedExts = MIME_EXT_MAP[mime];
    if (!allowedExts)
        return true; // No mapping — allow
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return allowedExts.includes(ext);
}
//# sourceMappingURL=file-validation.js.map