"use strict";
// ============================================================
// OrgsLedger API — Document Repository Routes
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const config_1 = require("../config");
const file_validation_1 = require("../utils/file-validation");
const router = (0, express_1.Router)();
// ── Multer setup for document uploads ───────────────────────
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = path_1.default.resolve(config_1.config.upload.dir, 'documents');
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
});
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
];
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error(`File type ${file.mimetype} is not allowed`));
        }
    },
});
// ── Upload Document ─────────────────────────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive', 'member'), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file provided' });
            return;
        }
        // ── Server-side file validation ──
        // 1. Verify magic bytes match claimed MIME type (prevents MIME spoofing)
        if (!(0, file_validation_1.verifyMagicBytes)(req.file.path, req.file.mimetype)) {
            // Delete the suspicious file
            try {
                fs_1.default.unlinkSync(req.file.path);
            }
            catch { }
            logger_1.logger.warn('[UPLOAD] Magic bytes mismatch', {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                userId: req.user.userId,
            });
            res.status(400).json({ success: false, error: 'File content does not match its type' });
            return;
        }
        // 2. Verify extension matches MIME type
        if (!(0, file_validation_1.validateMimeExtension)(req.file.originalname, req.file.mimetype)) {
            try {
                fs_1.default.unlinkSync(req.file.path);
            }
            catch { }
            logger_1.logger.warn('[UPLOAD] Extension/MIME mismatch', {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
            });
            res.status(400).json({ success: false, error: 'File extension does not match its type' });
            return;
        }
        // 3. Sanitize original filename for storage metadata
        const safeFilename = (0, file_validation_1.sanitizeFilename)(req.file.originalname);
        const { title, description, category, folderId } = req.body;
        const [doc] = await (0, db_1.default)('documents')
            .insert({
            organization_id: req.params.orgId,
            title: title || safeFilename,
            description: description || null,
            category: category || 'general',
            folder_id: folderId || null,
            file_name: safeFilename,
            file_path: `/uploads/documents/${req.file.filename}`,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
            uploaded_by: req.user.userId,
        })
            .returning('*');
        res.status(201).json({ success: true, data: doc });
    }
    catch (err) {
        logger_1.logger.error('Upload document error', err);
        res.status(500).json({ success: false, error: 'Failed to upload document' });
    }
});
// ── List Documents ──────────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const category = req.query.category;
        const search = req.query.search;
        const folderId = req.query.folderId;
        let query = (0, db_1.default)('documents')
            .where({ organization_id: req.params.orgId });
        if (category)
            query = query.where({ category });
        if (folderId)
            query = query.where({ folder_id: folderId });
        if (search) {
            const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
            query = query.where(function () {
                this.whereILike('title', `%${escapedSearch}%`)
                    .orWhereILike('description', `%${escapedSearch}%`);
            });
        }
        const total = await query.clone().clear('select').count('id as count').first();
        const docs = await query
            .join('users', 'documents.uploaded_by', 'users.id')
            .select('documents.*', 'users.first_name as uploader_first_name', 'users.last_name as uploader_last_name')
            .orderBy('documents.created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        res.json({
            success: true,
            data: docs,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list documents' });
    }
});
// ── Create Folder ───────────────────────────────────────────
router.post('/:orgId/folders', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const { name, parentId } = req.body;
        // Validate folder name
        if (!name || typeof name !== 'string' || !name.trim() || name.length > 200) {
            res.status(400).json({ success: false, error: 'Folder name is required and must be 1-200 characters' });
            return;
        }
        const [folder] = await (0, db_1.default)('document_folders')
            .insert({
            organization_id: req.params.orgId,
            name,
            parent_id: parentId || null,
            created_by: req.user.userId,
        })
            .returning('*');
        res.status(201).json({ success: true, data: folder });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create folder' });
    }
});
// ── List Folders ────────────────────────────────────────────
router.get('/:orgId/folders', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const folders = await (0, db_1.default)('document_folders')
            .where({ organization_id: req.params.orgId })
            .orderBy('name');
        res.json({ success: true, data: folders });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list folders' });
    }
});
// ── Get Document ────────────────────────────────────────────
router.get('/:orgId/:docId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const doc = await (0, db_1.default)('documents')
            .join('users', 'documents.uploaded_by', 'users.id')
            .where({ 'documents.id': req.params.docId, organization_id: req.params.orgId })
            .select('documents.*', 'users.first_name as uploader_first_name', 'users.last_name as uploader_last_name')
            .first();
        if (!doc) {
            res.status(404).json({ success: false, error: 'Document not found' });
            return;
        }
        res.json({ success: true, data: doc });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get document' });
    }
});
// ── Delete Document ─────────────────────────────────────────
router.delete('/:orgId/:docId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const doc = await (0, db_1.default)('documents')
            .where({ id: req.params.docId, organization_id: req.params.orgId })
            .first();
        if (!doc) {
            res.status(404).json({ success: false, error: 'Document not found' });
            return;
        }
        // Delete file from disk
        const filePath = path_1.default.resolve(config_1.config.upload.dir, 'documents', path_1.default.basename(doc.file_path));
        try {
            await fs_1.default.promises.access(filePath);
            await fs_1.default.promises.unlink(filePath);
        }
        catch {
            // File may not exist on disk — continue with DB deletion
        }
        await (0, db_1.default)('documents').where({ id: doc.id }).delete();
        res.json({ success: true, message: 'Document deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete document' });
    }
});
exports.default = router;
//# sourceMappingURL=documents.js.map