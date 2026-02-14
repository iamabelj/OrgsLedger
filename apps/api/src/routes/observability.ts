// ============================================================
// OrgsLedger API — Observability Routes
// Admin-only endpoints for metrics, errors, analytics dashboards.
// Mounted at /api/admin/observability/*
// ============================================================

import { Router, Request, Response } from 'express';
import { getMetricsSnapshot } from '../services/metrics.service';
import { getRecentErrors, getErrorStats, getErrorFrequency } from '../services/error-monitor.service';
import {
  getAnalyticsSnapshot,
  getRecentEvents,
  getOrgUsageSummary,
  getAllOrgUsage,
  getDailyTrends,
} from '../services/analytics.service';
import { authenticate, requireSuperAdmin } from '../middleware';

const router = Router();

// All observability routes require super admin
router.use(authenticate, requireSuperAdmin);

// ── Metrics Dashboard ─────────────────────────────────────
router.get('/metrics', (_req: Request, res: Response) => {
  res.json({ success: true, data: getMetricsSnapshot() });
});

// ── Error Monitoring ──────────────────────────────────────
router.get('/errors', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  res.json({ success: true, data: getRecentErrors(limit) });
});

router.get('/errors/stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: getErrorStats() });
});

router.get('/errors/frequency', (_req: Request, res: Response) => {
  res.json({ success: true, data: getErrorFrequency() });
});

// ── Usage Analytics ───────────────────────────────────────
router.get('/analytics', (_req: Request, res: Response) => {
  res.json({ success: true, data: getAnalyticsSnapshot() });
});

router.get('/analytics/events', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const eventFilter = req.query.event as string | undefined;
  res.json({ success: true, data: getRecentEvents(limit, eventFilter as any) });
});

router.get('/analytics/trends', (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query.days as string) || 7, 30);
  res.json({ success: true, data: getDailyTrends(days) });
});

router.get('/analytics/orgs', (_req: Request, res: Response) => {
  res.json({ success: true, data: getAllOrgUsage() });
});

router.get('/analytics/orgs/:orgId', (req: Request, res: Response) => {
  const usage = getOrgUsageSummary(req.params.orgId);
  if (!usage) {
    res.status(404).json({ success: false, error: 'No analytics data for this organization' });
    return;
  }
  res.json({ success: true, data: usage });
});

// ── Combined Dashboard ────────────────────────────────────
// Single call for all dashboard panels
router.get('/dashboard', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      metrics: getMetricsSnapshot(),
      errors: getErrorStats(),
      analytics: getAnalyticsSnapshot(),
    },
  });
});

export default router;
