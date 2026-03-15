// ============================================================
// OrgsLedger API — Member Records Routes
// Historical records import and management
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { config } from '../config';

const router = Router();

// ── Multer setup for CSV uploads ────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(config.upload.dir, 'records-import');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `import-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const csvUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max for CSV
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// ── Validation Schemas ──────────────────────────────────────

const createRecordSchema = z.object({
  userId: z.string().uuid().optional().nullable(),
  recordType: z.enum(['payment', 'dues', 'attendance', 'contribution', 'note', 'other']),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  amount: z.number().optional().nullable(),
  currency: z.string().length(3).optional(),
  recordDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
  category: z.string().max(100).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateRecordSchema = z.object({
  userId: z.string().uuid().optional().nullable(),
  recordType: z.enum(['payment', 'dues', 'attendance', 'contribution', 'note', 'other']).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  amount: z.number().optional().nullable(),
  currency: z.string().length(3).optional(),
  recordDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date').optional(),
  category: z.string().max(100).optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

const listQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  recordType: z.string().optional(),
  category: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  search: z.string().optional(),
});

// ── List Records ────────────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const query = listQuerySchema.parse(req.query);
      const page = query.page || 1;
      const limit = Math.min(query.limit || 50, 200);
      const offset = (page - 1) * limit;

      let dbQuery = db('member_records as r')
        .leftJoin('users as u', 'r.user_id', 'u.id')
        .where('r.organization_id', orgId)
        .select(
          'r.*',
          'u.first_name as member_first_name',
          'u.last_name as member_last_name',
          'u.email as member_email'
        );

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
        dbQuery = dbQuery.where(function() {
          this.whereILike('r.title', search)
            .orWhereILike('r.description', search)
            .orWhereILike('u.first_name', search)
            .orWhereILike('u.last_name', search);
        });
      }

      // Count total
      const countQuery = dbQuery.clone();
      const [{ count }] = await countQuery.clearSelect().count('r.id as count');
      const total = parseInt(count as string, 10);

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
    } catch (err) {
      logger.error('List records error', err);
      res.status(500).json({ success: false, error: 'Failed to list records' });
    }
  }
);

// ── Get Single Record ───────────────────────────────────────
router.get(
  '/:orgId/:recordId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, recordId } = req.params;

      const record = await db('member_records as r')
        .leftJoin('users as u', 'r.user_id', 'u.id')
        .leftJoin('users as uploader', 'r.uploaded_by', 'uploader.id')
        .where('r.organization_id', orgId)
        .where('r.id', recordId)
        .select(
          'r.*',
          'u.first_name as member_first_name',
          'u.last_name as member_last_name',
          'u.email as member_email',
          'uploader.first_name as uploader_first_name',
          'uploader.last_name as uploader_last_name'
        )
        .first();

      if (!record) {
        res.status(404).json({ success: false, error: 'Record not found' });
        return;
      }

      res.json({ success: true, data: record });
    } catch (err) {
      logger.error('Get record error', err);
      res.status(500).json({ success: false, error: 'Failed to get record' });
    }
  }
);

// ── Create Single Record (Admin only) ───────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createRecordSchema),
  async (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const userId = req.user!.userId;
      const data = req.body;

      const [record] = await db('member_records')
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

      logger.info('[RECORDS] Record created', {
        recordId: record.id,
        orgId,
        recordType: data.recordType,
        userId: data.userId,
      });

      res.status(201).json({ success: true, data: record });
    } catch (err) {
      logger.error('Create record error', err);
      res.status(500).json({ success: false, error: 'Failed to create record' });
    }
  }
);

// ── Bulk Import CSV (Admin only) ────────────────────────────
router.post(
  '/:orgId/import',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  csvUpload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const userId = req.user!.userId;

      if (!req.file) {
        res.status(400).json({ success: false, error: 'No CSV file provided' });
        return;
      }

      // Read and parse CSV
      const csvContent = fs.readFileSync(req.file.path, 'utf-8');
      let rows: any[];
      
      try {
        rows = csvParse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });
      } catch (parseErr: any) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ 
          success: false, 
          error: 'Invalid CSV format: ' + parseErr.message 
        });
        return;
      }

      if (rows.length === 0) {
        fs.unlinkSync(req.file.path);
        res.status(400).json({ success: false, error: 'CSV file is empty' });
        return;
      }

      // Generate batch ID for this import
      const batchId = require('crypto').randomUUID();

      // Get all org members for email lookup
      const members = await db('memberships as m')
        .join('users as u', 'm.user_id', 'u.id')
        .where({ 'm.organization_id': orgId, 'm.is_active': true })
        .select('u.id', 'u.email', 'u.first_name', 'u.last_name');

      const emailToUserId = new Map<string, string>();
      members.forEach((m: any) => {
        emailToUserId.set(m.email.toLowerCase(), m.id);
      });

      // Process rows
      const recordsToInsert: any[] = [];
      const errors: { row: number; error: string }[] = [];

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
          let parsedDate: Date;
          try {
            parsedDate = new Date(recordDate);
            if (isNaN(parsedDate.getTime())) throw new Error('Invalid date');
          } catch {
            errors.push({ row: rowNum, error: `Invalid date format: ${recordDate}` });
            continue;
          }

          // Resolve member email to user ID
          const memberEmail = (row.member_email || row.email || row.Email || row.EMAIL || '').toLowerCase();
          let memberId: string | null = null;
          if (memberEmail && emailToUserId.has(memberEmail)) {
            memberId = emailToUserId.get(memberEmail)!;
          }

          // Parse amount
          let amount: number | null = null;
          const rawAmount = row.amount || row.Amount || row.AMOUNT;
          if (rawAmount) {
            const parsed = parseFloat(String(rawAmount).replace(/[^0-9.-]/g, ''));
            if (!isNaN(parsed)) amount = parsed;
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
        } catch (rowErr: any) {
          errors.push({ row: rowNum, error: rowErr.message });
        }
      }

      // Batch insert valid records
      let insertedCount = 0;
      if (recordsToInsert.length > 0) {
        await db('member_records').insert(recordsToInsert);
        insertedCount = recordsToInsert.length;
      }

      // Clean up uploaded file
      try { fs.unlinkSync(req.file.path); } catch {}

      logger.info('[RECORDS] CSV import completed', {
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
    } catch (err) {
      logger.error('CSV import error', err);
      // Clean up file on error
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      res.status(500).json({ success: false, error: 'Failed to import CSV' });
    }
  }
);

// ── Download CSV Template ───────────────────────────────────
router.get(
  '/:orgId/template',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    const template = `member_email,record_type,title,description,amount,currency,record_date,category
john@example.com,payment,Monthly Dues - January 2025,Payment received,50.00,USD,2025-01-15,dues
jane@example.com,attendance,Annual General Meeting,Present at AGM,,USD,2025-01-10,meeting
,contribution,Office Renovation Fund,Organization-wide contribution goal,5000.00,USD,2024-12-01,fundraising
member@org.com,note,Welcome Note,Joined the organization,,USD,2024-06-15,membership`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=records_import_template.csv');
    res.send(template);
  }
);

// ── Update Record (Admin only) ──────────────────────────────
router.patch(
  '/:orgId/:recordId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(updateRecordSchema),
  async (req: Request, res: Response) => {
    try {
      const { orgId, recordId } = req.params;
      const data = req.body;

      // Build update object
      const updates: Record<string, any> = {};
      if (data.userId !== undefined) updates.user_id = data.userId;
      if (data.recordType) updates.record_type = data.recordType;
      if (data.title) updates.title = data.title;
      if (data.description !== undefined) updates.description = data.description;
      if (data.amount !== undefined) updates.amount = data.amount;
      if (data.currency) updates.currency = data.currency;
      if (data.recordDate) updates.record_date = data.recordDate;
      if (data.category !== undefined) updates.category = data.category;
      if (data.metadata) updates.metadata = data.metadata;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ success: false, error: 'No fields to update' });
        return;
      }

      const [record] = await db('member_records')
        .where({ id: recordId, organization_id: orgId })
        .update(updates)
        .returning('*');

      if (!record) {
        res.status(404).json({ success: false, error: 'Record not found' });
        return;
      }

      logger.info('[RECORDS] Record updated', { recordId, orgId });

      res.json({ success: true, data: record });
    } catch (err) {
      logger.error('Update record error', err);
      res.status(500).json({ success: false, error: 'Failed to update record' });
    }
  }
);

// ── Delete Record (Admin only) ──────────────────────────────
router.delete(
  '/:orgId/:recordId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const { orgId, recordId } = req.params;

      const deleted = await db('member_records')
        .where({ id: recordId, organization_id: orgId })
        .delete();

      if (!deleted) {
        res.status(404).json({ success: false, error: 'Record not found' });
        return;
      }

      logger.info('[RECORDS] Record deleted', { recordId, orgId });

      res.json({ success: true });
    } catch (err) {
      logger.error('Delete record error', err);
      res.status(500).json({ success: false, error: 'Failed to delete record' });
    }
  }
);

// ── Delete Import Batch (Admin only) ────────────────────────
router.delete(
  '/:orgId/batch/:batchId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const { orgId, batchId } = req.params;

      const deleted = await db('member_records')
        .where({ organization_id: orgId, import_batch_id: batchId })
        .delete();

      logger.info('[RECORDS] Import batch deleted', { batchId, orgId, count: deleted });

      res.json({ success: true, data: { deletedCount: deleted } });
    } catch (err) {
      logger.error('Delete batch error', err);
      res.status(500).json({ success: false, error: 'Failed to delete batch' });
    }
  }
);

// ── Get Record Types & Categories (for filters) ─────────────
router.get(
  '/:orgId/filters',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;

      const [types, categories] = await Promise.all([
        db('member_records')
          .where('organization_id', orgId)
          .distinct('record_type')
          .pluck('record_type'),
        db('member_records')
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
    } catch (err) {
      logger.error('Get filters error', err);
      res.status(500).json({ success: false, error: 'Failed to get filters' });
    }
  }
);

// ── Get My Records (for current user) ───────────────────────
router.get(
  '/:orgId/my-records',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const userId = req.user!.userId;
      const query = listQuerySchema.parse(req.query);
      const page = query.page || 1;
      const limit = Math.min(query.limit || 50, 200);
      const offset = (page - 1) * limit;

      let dbQuery = db('member_records')
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
      const total = parseInt(count as string, 10);

      const records = await dbQuery
        .orderBy('record_date', 'desc')
        .offset(offset)
        .limit(limit);

      res.json({
        success: true,
        data: records,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      logger.error('Get my records error', err);
      res.status(500).json({ success: false, error: 'Failed to get records' });
    }
  }
);

export default router;
