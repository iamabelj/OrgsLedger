"use strict";
// ============================================================
// OrgsLedger API — Observability Routes
// Admin-only endpoints for metrics, errors, analytics dashboards.
// Mounted at /api/admin/observability/*
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const metrics_service_1 = require("../services/metrics.service");
const error_monitor_service_1 = require("../services/error-monitor.service");
const analytics_service_1 = require("../services/analytics.service");
const middleware_1 = require("../middleware");
const router = (0, express_1.Router)();
// All observability routes require super admin
router.use(middleware_1.authenticate, middleware_1.requireDeveloper);
// ── Metrics Dashboard ─────────────────────────────────────
router.get('/metrics', (_req, res) => {
    res.json({ success: true, data: (0, metrics_service_1.getMetricsSnapshot)() });
});
// ── Error Monitoring ──────────────────────────────────────
router.get('/errors', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json({ success: true, data: (0, error_monitor_service_1.getRecentErrors)(limit) });
});
router.get('/errors/stats', (_req, res) => {
    res.json({ success: true, data: (0, error_monitor_service_1.getErrorStats)() });
});
router.get('/errors/frequency', (_req, res) => {
    res.json({ success: true, data: (0, error_monitor_service_1.getErrorFrequency)() });
});
// ── Usage Analytics ───────────────────────────────────────
router.get('/analytics', (_req, res) => {
    res.json({ success: true, data: (0, analytics_service_1.getAnalyticsSnapshot)() });
});
router.get('/analytics/events', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const eventFilter = req.query.event;
    res.json({ success: true, data: (0, analytics_service_1.getRecentEvents)(limit, eventFilter) });
});
router.get('/analytics/trends', (req, res) => {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    res.json({ success: true, data: (0, analytics_service_1.getDailyTrends)(days) });
});
router.get('/analytics/orgs', (_req, res) => {
    res.json({ success: true, data: (0, analytics_service_1.getAllOrgUsage)() });
});
router.get('/analytics/orgs/:orgId', (req, res) => {
    const usage = (0, analytics_service_1.getOrgUsageSummary)(req.params.orgId);
    if (!usage) {
        res.status(404).json({ success: false, error: 'No analytics data for this organization' });
        return;
    }
    res.json({ success: true, data: usage });
});
// ── Combined Dashboard ────────────────────────────────────
// Single call for all dashboard panels
router.get('/dashboard', (_req, res) => {
    res.json({
        success: true,
        data: {
            metrics: (0, metrics_service_1.getMetricsSnapshot)(),
            errors: (0, error_monitor_service_1.getErrorStats)(),
            analytics: (0, analytics_service_1.getAnalyticsSnapshot)(),
        },
    });
});
exports.default = router;
//# sourceMappingURL=observability.js.map