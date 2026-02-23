// ============================================================
// Test — File Upload Validation Utilities
// Validates: magic bytes verification, filename sanitization,
// MIME-extension matching, path traversal prevention.
// ============================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifyMagicBytes, sanitizeFilename, validateMimeExtension } from '../utils/file-validation';

describe('File Validation Utilities', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-validation-'));
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  });

  // ── sanitizeFilename ────────────────────────────────────

  describe('sanitizeFilename', () => {
    it('should strip directory components', () => {
      expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
      expect(sanitizeFilename('/var/log/syslog')).toBe('syslog');
    });

    it('should remove null bytes', () => {
      expect(sanitizeFilename('file\0.txt')).toBe('file.txt');
    });

    it('should remove leading dots', () => {
      expect(sanitizeFilename('.htaccess')).toBe('htaccess');
      expect(sanitizeFilename('..hidden')).toBe('hidden');
    });

    it('should remove dangerous characters', () => {
      const result = sanitizeFilename('file<>:"|?*.txt');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('|');
      expect(result).toContain('.txt');
    });

    it('should return "unnamed_file" for empty or dot-only names', () => {
      expect(sanitizeFilename('')).toBe('unnamed_file');
      expect(sanitizeFilename('.')).toBe('unnamed_file');
      expect(sanitizeFilename('..')).toBe('unnamed_file');
    });

    it('should truncate long filenames to 255 chars', () => {
      const longName = 'a'.repeat(300) + '.pdf';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result).toContain('.pdf');
    });

    it('should keep normal filenames unchanged', () => {
      expect(sanitizeFilename('report-2024.pdf')).toBe('report-2024.pdf');
      expect(sanitizeFilename('photo.jpeg')).toBe('photo.jpeg');
    });
  });

  // ── validateMimeExtension ───────────────────────────────

  describe('validateMimeExtension', () => {
    it('should accept matching MIME/extension pairs', () => {
      expect(validateMimeExtension('doc.pdf', 'application/pdf')).toBe(true);
      expect(validateMimeExtension('photo.jpg', 'image/jpeg')).toBe(true);
      expect(validateMimeExtension('photo.jpeg', 'image/jpeg')).toBe(true);
      expect(validateMimeExtension('image.png', 'image/png')).toBe(true);
    });

    it('should reject mismatched MIME/extension pairs', () => {
      expect(validateMimeExtension('script.exe', 'application/pdf')).toBe(false);
      expect(validateMimeExtension('doc.pdf', 'image/jpeg')).toBe(false);
    });

    it('should accept unknown MIME types (no mapping)', () => {
      expect(validateMimeExtension('file.xyz', 'application/octet-stream')).toBe(true);
    });

    it('should be case insensitive on extensions', () => {
      expect(validateMimeExtension('DOC.PDF', 'application/pdf')).toBe(true);
      expect(validateMimeExtension('photo.JPG', 'image/jpeg')).toBe(true);
    });
  });

  // ── verifyMagicBytes ────────────────────────────────────

  describe('verifyMagicBytes', () => {
    it('should verify a valid PDF file', () => {
      const filePath = path.join(tmpDir, 'test.pdf');
      // Write PDF magic bytes
      fs.writeFileSync(filePath, Buffer.from('%PDF-1.4 fake content'));
      expect(verifyMagicBytes(filePath, 'application/pdf')).toBe(true);
    });

    it('should reject a fake PDF (wrong magic bytes)', () => {
      const filePath = path.join(tmpDir, 'fake.pdf');
      fs.writeFileSync(filePath, Buffer.from('This is not a PDF'));
      expect(verifyMagicBytes(filePath, 'application/pdf')).toBe(false);
    });

    it('should verify a valid PNG file', () => {
      const filePath = path.join(tmpDir, 'test.png');
      fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
      expect(verifyMagicBytes(filePath, 'image/png')).toBe(true);
    });

    it('should verify a valid JPEG file', () => {
      const filePath = path.join(tmpDir, 'test.jpg');
      fs.writeFileSync(filePath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00]));
      expect(verifyMagicBytes(filePath, 'image/jpeg')).toBe(true);
    });

    it('should return true for text/plain (no magic bytes check)', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'Just some text');
      expect(verifyMagicBytes(filePath, 'text/plain')).toBe(true);
    });

    it('should return true for text/csv (no magic bytes check)', () => {
      const filePath = path.join(tmpDir, 'test.csv');
      fs.writeFileSync(filePath, 'col1,col2\nval1,val2');
      expect(verifyMagicBytes(filePath, 'text/csv')).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(verifyMagicBytes('/nonexistent/file.pdf', 'application/pdf')).toBe(false);
    });
  });
});
