"use strict";
// ============================================================
// OrgsLedger API — Member Records Routes
// Historical records import and management
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const sync_1 = require("csv-parse/sync");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// ── Multer setup for CSV uploads ────────────────────────────
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = path_1.default.resolve(config_1.config.upload.dir, 'records-import');
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `import-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
});
const csvUpload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max for CSV
    fileFilter: (_req, file, cb) => {
        const allowed = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
        if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only CSV files are allowed'));
        }
    },
});
// ── Validation Schemas ──────────────────────────────────────
const createRecordSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid().optional().nullable(),
    recordType: zod_1.z.enum(['payment', 'dues', 'attendance', 'contribution', 'note', 'other']),
    title: zod_1.z.string().min(1).max(255),
    description: zod_1.z.string().max(2000).optional(),
    amount: zod_1.z.number().optional().nullable(),
    currency: zod_1.z.string().length(3).optional(),
    recordDate: zod_1.z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
    category: zod_1.z.string().max(100).optional(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
});
const updateRecordSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid().optional().nullable(),
    recordType: zod_1.z.enum(['payment', 'dues', 'attendance', 'contribution', 'note', 'other']).optional(),
    title: zod_1.z.string().min(1).max(255).optional(),
    description: zod_1.z.string().max(2000).optional().nullable(),
    amount: zod_1.z.number().optional().nullable(),
    currency: zod_1.z.string().length(3).optional(),
    recordDate: zod_1.z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date').optional(),
    category: zod_1.z.string().max(100).optional().nullable(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
});
const listQuerySchema = zod_1.z.object({
    userId: zod_1.z.string().uuid().optional(),
    recordType: zod_1.z.string().optional(),
    category: zod_1.z.string().optional(),
    startDate: zod_1.z.string().optional(),
    endDate: zod_1.z.string().optional(),
    page: zod_1.z.string().transform(Number).optional(),
    limit: zod_1.z.string().transform(Number).optional(),
    search: zod_1.z.string().optional(),
});
// ── List Records ────────────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { orgId } = req.params;
        const query = listQuerySchema.parse(req.query);
        const page = query.page || 1;
        const limit = Math.min(query.limit || 50, 200);
        const offset = (page - 1) * limit;
        let dbQuery = (0, db_1.default)('member_records as r')
            .leftJoin('users as u', 'r.user_id', 'u.id')
            .where('r.organization_id', orgId)
            .select('r.*', 'u.first_name as member_first_name', 'u.last_name as member_last_name', 'u.email as member_email');
        // Apply filters
        if (query.userId) {
            dbQuery = dbQuery.where('r.user_id', query.userId);
        }
        if (query.recordType) {
            dbQuery = dbQuery.where('r.record_type', query.recordType);
        }
        if (query.category) {
            dbQuery = dbQuery.where('r.category', query.category);
        }
        if (query.startDate) {
            dbQuery = dbQuery.where('r.record_date', '>=', query.startDate);
        }
        if (query.endDate) {
            dbQuery = dbQuery.where('r.record_date', '<=', query.endDate);
        }
        if (query.search) {
            const search = `%${query.search}%`;
            dbQuery = dbQuery.where(function () {
                this.whereILike('r.title', search)
                    .orWhereILike('r.description', search)
                    .orWhereILike('u.first_name', search)
                    .orWhereILike('u.last_name', search);
            });
        }
        // Count total
        const countQuery = dbQuery.clone();
        const [{ count }] = await countQuery.clearSelect().count('r.id as count');
        const total = parseInt(count, 10);
        // Get paginated results
        const records = await dbQuery
            .orderBy('r.record_date', 'desc')
            .orderBy('r.created_at', 'desc')
            .offset(offset)
            .limit(limit);
        res.json({
            success: true,
            data: records,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (err) {
        logger_1.logger.error('List records error', err);
        res.status(500).json({ success: false, error: 'Failed to list records' });
    }
});
// ── Get Single Record ───────────────────────────────────────
router.get('/:orgId/:recordId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { orgId, recordId } = req.params;
        const record = await (0, db_1.default)('member_records as r')
            .leftJoin('users as u', 'r.user_id', 'u.id')
            .leftJoin('users as uploader', 'r.uploaded_by', 'uploader.id')
            .where('r.organization_id', orgId)
            .where('r.id', recordId)
            .select('r.*', 'u.first_name as member_first_name', 'u.last_name as member_last_name', 'u.email as member_email', 'uploader.first_name as uploader_first_name', 'uploader.last_name as uploader_last_name')
            .first();
        if (!record) {
            res.status(404).json({ success: false, error: 'Record not found' });
            return;
        }
        res.json({ success: true, data: record });
    }
    catch (err) {
        logger_1.logger.error('Get record error', err);
        res.status(500).json({ success: false, error: 'Failed to get record' });
    }
});
// ── Create Single Record (Admin only) ───────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createRecordSchema), async (req, res) => {
    try {
        const { orgId } = req.params;
        const userId = req.user.userId;
        const data = req.body;
        const [record] = await (0, db_1.default)('member_records')
            .insert({
            organization_id: orgId,
            user_id: data.userId || null,
            record_type: data.recordType,
            title: data.title,
            description: data.description || null,
            amount: data.amount || null,
            currency: data.currency || 'USD',
            record_date: data.recordDate,
            category: data.category || null,
            metadata: data.metadata || {},
            uploaded_by: userId,
        })
            .returning('*');
        logger_1.logger.info('[RECORDS] Record created', {
            recordId: record.id,
            orgId,
            recordType: data.recordType,
            userId: data.userId,
        });
        res.status(201).json({ success: true, data: record });
    }
    catch (err) {
        logger_1.logger.error('Create record error', err);
        res.status(500).json({ success: false, error: 'Failed to create record' });
    }
});
// ── Bulk Import CSV (Admin only) ────────────────────────────
router.post('/:orgId/import', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), csvUpload.single('file'), async (req, res) => {
    try {
        const { orgId } = req.params;
        const userId = req.user.userId;
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No CSV file provided' });
            return;
        }
        // Read and parse CSV
        const csvContent = fs_1.default.readFileSync(req.file.path, 'utf-8');
        let rows;
        try {
            rows = (0, sync_1.parse)(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
            });
        }
        catch (parseErr) {
            fs_1.default.unlinkSync(req.file.path);
            res.status(400).json({
                success: false,
                error: 'Invalid CSV format: ' + parseErr.message
            });
            return;
        }
        if (rows.length === 0) {
            fs_1.default.unlinkSync(req.file.path);
            res.status(400).json({ success: false, error: 'CSV file is empty' });
            return;
        }
        // Generate batch ID for this import
        const batchId = require('crypto').randomUUID();
        // Get all org members for email lookup
        const members = await (0, db_1.default)('memberships as m')
            .join('users as u', 'm.user_id', 'u.id')
            .where({ 'm.organization_id': orgId, 'm.is_active': true })
            .select('u.id', 'u.email', 'u.first_name', 'u.last_name');
        const emailToUserId = new Map();
        members.forEach((m) => {
            emailToUserId.set(m.email.toLowerCase(), m.id);
        });
        // Process rows
        const recordsToInsert = [];
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // +2 because of header row and 0-index
            try {
                // Required fields
                const title = row.title || row.Title || row.TITLE;
                const recordDate = row.record_date || row.date || row.Date || row.DATE;
                if (!title) {
                    errors.push({ row: rowNum, error: 'Missing title' });
                    continue;
                }
                if (!recordDate) {
                    errors.push({ row: rowNum, error: 'Missing record_date/date' });
                    continue;
                }
                // Parse date
                let parsedDate;
                try {
                    parsedDate = new Date(recordDate);
                    if (isNaN(parsedDate.getTime()))
                        throw new Error('Invalid date');
                }
                catch {
                    errors.push({ row: rowNum, error: `Invalid date format: ${recordDate}` });
                    continue;
                }
                // Resolve member email to user ID
                const memberEmail = (row.member_email || row.email || row.Email || row.EMAIL || '').toLowerCase();
                let memberId = null;
                if (memberEmail && emailToUserId.has(memberEmail)) {
                    memberId = emailToUserId.get(memberEmail);
                }
                // Parse amount
                let amount = null;
                const rawAmount = row.amount || row.Amount || row.AMOUNT;
                if (rawAmount) {
                    const parsed = parseFloat(String(rawAmount).replace(/[^0-9.-]/g, ''));
                    if (!isNaN(parsed))
                        amount = parsed;
                }
                // Build record
                recordsToInsert.push({
                    organization_id: orgId,
                    user_id: memberId,
                    record_type: row.record_type || row.type || row.Type || 'other',
                    title: title,
                    description: row.description || row.Description || null,
                    amount: amount,
                    currency: row.currency || row.Currency || 'USD',
                    record_date: parsedDate.toISOString().split('T')[0],
                    category: row.category || row.Category || null,
                    metadata: {},
                    import_batch_id: batchId,
                    uploaded_by: userId,
                });
            }
            catch (rowErr) {
                errors.push({ row: rowNum, error: rowErr.message });
            }
        }
        // Batch insert valid records
        let insertedCount = 0;
        if (recordsToInsert.length > 0) {
            await (0, db_1.default)('member_records').insert(recordsToInsert);
            insertedCount = recordsToInsert.length;
        }
        // Clean up uploaded file
        try {
            fs_1.default.unlinkSync(req.file.path);
        }
        catch { }
        logger_1.logger.info('[RECORDS] CSV import completed', {
            orgId,
            batchId,
            totalRows: rows.length,
            inserted: insertedCount,
            errors: errors.length,
        });
        res.json({
            success: true,
            data: {
                batchId,
                totalRows: rows.length,
                imported: insertedCount,
                errors: errors.length > 0 ? errors.slice(0, 50) : [], // Return first 50 errors
                hasMoreErrors: errors.length > 50,
            },
        });
    }
    catch (err) {
        logger_1.logger.error('CSV import error', err);
        // Clean up file on error
        if (req.file?.path) {
            try {
                fs_1.default.unlinkSync(req.file.path);
            }
            catch { }
        }
        res.status(500).json({ success: false, error: 'Failed to import CSV' });
    }
});
// ── Download CSV Template ───────────────────────────────────
router.get('/:orgId/template', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    const template = `member_email,record_type,title,description,amount,currency,record_date,category
john@example.com,payment,Monthly Dues - January 2025,Payment received,50.00,USD,2025-01-15,dues
jane@example.com,attendance,Annual General Meeting,Present at AGM,,USD,2025-01-10,meeting
,contribution,Office Renovation Fund,Organization-wide contribution goal,5000.00,USD,2024-12-01,fundraising
member@org.com,note,Welcome Note,Joined the organization,,USD,2024-06-15,membership`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=records_import_template.csv');
    res.send(template);
});
// ── Update Record (Admin only) ──────────────────────────────
router.patch('/:orgId/:recordId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(updateRecordSchema), async (req, res) => {
    try {
        const { orgId, recordId } = req.params;
        const data = req.body;
        // Build update object
        const updates = {};
        if (data.userId !== undefined)
            updates.user_id = data.userId;
        if (data.recordType)
            updates.record_type = data.recordType;
        if (data.title)
            updates.title = data.title;
        if (data.description !== undefined)
            updates.description = data.description;
        if (data.amount !== undefined)
            updates.amount = data.amount;
        if (data.currency)
            updates.currency = data.currency;
        if (data.recordDate)
            updates.record_date = data.recordDate;
        if (data.category !== undefined)
            updates.category = data.category;
        if (data.metadata)
            updates.metadata = data.metadata;
        if (Object.keys(updates).length === 0) {
            res.status(400).json({ success: false, error: 'No fields to update' });
            return;
        }
        const [record] = await (0, db_1.default)('member_records')
            .where({ id: recordId, organization_id: orgId })
            .update(updates)
            .returning('*');
        if (!record) {
            res.status(404).json({ success: false, error: 'Record not found' });
            return;
        }
        logger_1.logger.info('[RECORDS] Record updated', { recordId, orgId });
        res.json({ success: true, data: record });
    }
    catch (err) {
        logger_1.logger.error('Update record error', err);
        res.status(500).json({ success: false, error: 'Failed to update record' });
    }
});
// ── Delete Record (Admin only) ──────────────────────────────
router.delete('/:orgId/:recordId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const { orgId, recordId } = req.params;
        const deleted = await (0, db_1.default)('member_records')
            .where({ id: recordId, organization_id: orgId })
            .delete();
        if (!deleted) {
            res.status(404).json({ success: false, error: 'Record not found' });
            return;
        }
        logger_1.logger.info('[RECORDS] Record deleted', { recordId, orgId });
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('Delete record error', err);
        res.status(500).json({ success: false, error: 'Failed to delete record' });
    }
});
// ── Delete Import Batch (Admin only) ────────────────────────
router.delete('/:orgId/batch/:batchId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const { orgId, batchId } = req.params;
        const deleted = await (0, db_1.default)('member_records')
            .where({ organization_id: orgId, import_batch_id: batchId })
            .delete();
        logger_1.logger.info('[RECORDS] Import batch deleted', { batchId, orgId, count: deleted });
        res.json({ success: true, data: { deletedCount: deleted } });
    }
    catch (err) {
        logger_1.logger.error('Delete batch error', err);
        res.status(500).json({ success: false, error: 'Failed to delete batch' });
    }
});
// ── Get Record Types & Categories (for filters) ─────────────
router.get('/:orgId/filters', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { orgId } = req.params;
        const [types, categories] = await Promise.all([
            (0, db_1.default)('member_records')
                .where('organization_id', orgId)
                .distinct('record_type')
                .pluck('record_type'),
            (0, db_1.default)('member_records')
                .where('organization_id', orgId)
                .whereNotNull('category')
                .distinct('category')
                .pluck('category'),
        ]);
        res.json({
            success: true,
            data: {
                recordTypes: types,
                categories: categories.filter(Boolean),
            },
        });
    }
    catch (err) {
        logger_1.logger.error('Get filters error', err);
        res.status(500).json({ success: false, error: 'Failed to get filters' });
    }
});
// ── Get My Records (for current user) ───────────────────────
router.get('/:orgId/my-records', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const { orgId } = req.params;
        const userId = req.user.userId;
        const query = listQuerySchema.parse(req.query);
        const page = query.page || 1;
        const limit = Math.min(query.limit || 50, 200);
        const offset = (page - 1) * limit;
        let dbQuery = (0, db_1.default)('member_records')
            .where('organization_id', orgId)
            .where('user_id', userId);
        if (query.recordType) {
            dbQuery = dbQuery.where('record_type', query.recordType);
        }
        if (query.category) {
            dbQuery = dbQuery.where('category', query.category);
        }
        const countQuery = dbQuery.clone();
        const [{ count }] = await countQuery.count('id as count');
        const total = parseInt(count, 10);
        const records = await dbQuery
            .orderBy('record_date', 'desc')
            .offset(offset)
            .limit(limit);
        res.json({
            success: true,
            data: records,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    }
    catch (err) {
        logger_1.logger.error('Get my records error', err);
        res.status(500).json({ success: false, error: 'Failed to get records' });
    }
});
exports.default = router;
//# sourceMappingURL=records.js.map