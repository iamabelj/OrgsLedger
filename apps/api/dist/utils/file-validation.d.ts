/**
 * Verify file content matches its claimed MIME type by checking magic bytes.
 * Returns true if the file signature matches or if no signature is defined
 * for the given MIME type (text files, CSV, etc.).
 */
export declare function verifyMagicBytes(filePath: string, claimedMime: string): boolean;
/**
 * Sanitize a filename to prevent path traversal attacks.
 * Strips directory components, null bytes, and dangerous characters.
 */
export declare function sanitizeFilename(filename: string): string;
export declare function validateMimeExtension(filename: string, mime: string): boolean;
//# sourceMappingURL=file-validation.d.ts.map