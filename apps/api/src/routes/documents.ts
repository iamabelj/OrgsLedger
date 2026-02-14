// ============================================================
// OrgsLedger API — Document Repository Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { config } from '../config';

const router = Router();

// ── Multer setup for document uploads ───────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(config.upload.dir, 'documents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
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

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

// ── Upload Document ─────────────────────────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No file provided' });
        return;
      }

      const { title, description, category, folderId } = req.body;

      const [doc] = await db('documents')
        .insert({
          organization_id: req.params.orgId,
          title: title || req.file.originalname,
          description: description || null,
          category: category || 'general',
          folder_id: folderId || null,
          file_name: req.file.originalname,
          file_path: `/uploads/documents/${req.file.filename}`,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          uploaded_by: req.user!.userId,
        })
        .returning('*');

      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      logger.error('Upload document error', err);
      res.status(500).json({ success: false, error: 'Failed to upload document' });
    }
  }
);

// ── List Documents ──────────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const category = req.query.category as string;
      const search = req.query.search as string;
      const folderId = req.query.folderId as string;

      let query = db('documents')
        .where({ organization_id: req.params.orgId });

      if (category) query = query.where({ category });
      if (folderId) query = query.where({ folder_id: folderId });
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
        .select(
          'documents.*',
          'users.first_name as uploader_first_name',
          'users.last_name as uploader_last_name'
        )
        .orderBy('documents.created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      res.json({
        success: true,
        data: docs,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list documents' });
    }
  }
);

// ── Create Folder ───────────────────────────────────────────
router.post(
  '/:orgId/folders',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const { name, parentId } = req.body;

      const [folder] = await db('document_folders')
        .insert({
          organization_id: req.params.orgId,
          name,
          parent_id: parentId || null,
          created_by: req.user!.userId,
        })
        .returning('*');

      res.status(201).json({ success: true, data: folder });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to create folder' });
    }
  }
);

// ── List Folders ────────────────────────────────────────────
router.get(
  '/:orgId/folders',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const folders = await db('document_folders')
        .where({ organization_id: req.params.orgId })
        .orderBy('name');

      res.json({ success: true, data: folders });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list folders' });
    }
  }
);

// ── Get Document ────────────────────────────────────────────
router.get(
  '/:orgId/:docId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const doc = await db('documents')
        .join('users', 'documents.uploaded_by', 'users.id')
        .where({ 'documents.id': req.params.docId, organization_id: req.params.orgId })
        .select(
          'documents.*',
          'users.first_name as uploader_first_name',
          'users.last_name as uploader_last_name'
        )
        .first();

      if (!doc) {
        res.status(404).json({ success: false, error: 'Document not found' });
        return;
      }

      res.json({ success: true, data: doc });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get document' });
    }
  }
);

// ── Delete Document ─────────────────────────────────────────
router.delete(
  '/:orgId/:docId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const doc = await db('documents')
        .where({ id: req.params.docId, organization_id: req.params.orgId })
        .first();

      if (!doc) {
        res.status(404).json({ success: false, error: 'Document not found' });
        return;
      }

      // Delete file from disk
      const filePath = path.resolve(config.upload.dir, 'documents', path.basename(doc.file_path));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await db('documents').where({ id: doc.id }).delete();
      res.json({ success: true, message: 'Document deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete document' });
    }
  }
);

export default router;
