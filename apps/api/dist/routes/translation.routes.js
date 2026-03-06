"use strict";
// ============================================================
// OrgsLedger API — Translation Controller
// HTTP endpoints for translation requests
// Submits jobs to processing queue for async handling
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.translationRouter = void 0;
const express_1 = require("express");
const logger_1 = require("../logger");
const processing_queue_1 = require("../queues/processing.queue");
exports.translationRouter = (0, express_1.Router)();
/**
 * POST /api/meetings/:meetingId/translate
 * Submit translation job for STT output
 */
exports.translationRouter.post('/meetings/:meetingId/translate', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { speakerId, originalText, sourceLanguage, targetLanguages, isFinal = false, } = req.body;
        // Validate required fields
        if (!speakerId || !originalText || !sourceLanguage || !targetLanguages) {
            res.status(400).json({
                error: 'Missing required fields: speakerId, originalText, sourceLanguage, targetLanguages',
            });
            return;
        }
        if (!Array.isArray(targetLanguages) || targetLanguages.length === 0) {
            res.status(400).json({
                error: 'targetLanguages must be a non-empty array',
            });
            return;
        }
        // Submit to processing queue
        const jobId = await (0, processing_queue_1.submitProcessingJob)({
            meetingId,
            speakerId,
            originalText,
            sourceLanguage,
            targetLanguages,
            isFinal,
        });
        logger_1.logger.debug('Translation job submitted', {
            jobId,
            meetingId,
            speakerId,
            isFinal,
            textLength: originalText.length,
        });
        res.status(202).json({
            jobId,
            status: 'queued',
            meetingId,
            speakerId,
            message: 'Translation job queued for processing',
        });
    }
    catch (err) {
        logger_1.logger.error('Failed to submit translation job', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to submit translation job',
        });
    }
});
/**
 * POST /api/meetings/:meetingId/translate/interim
 * Submit interim translation (for streaming/partial results)
 */
exports.translationRouter.post('/meetings/:meetingId/translate/interim', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { speakerId, originalText, sourceLanguage, targetLanguages } = req.body;
        // Validate required fields
        if (!speakerId || !originalText || !sourceLanguage || !targetLanguages) {
            res.status(400).json({
                error: 'Missing required fields',
            });
            return;
        }
        // Submit as interim (not final)
        const jobId = await (0, processing_queue_1.submitProcessingJob)({
            meetingId,
            speakerId,
            originalText,
            sourceLanguage,
            targetLanguages,
            isFinal: false,
        });
        res.status(202).json({
            jobId,
            status: 'queued',
            type: 'interim',
        });
    }
    catch (err) {
        logger_1.logger.error('Failed to submit interim translation job', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to submit translation job',
        });
    }
});
/**
 * POST /api/meetings/:meetingId/translate/final
 * Submit final translation
 */
exports.translationRouter.post('/meetings/:meetingId/translate/final', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { speakerId, originalText, sourceLanguage, targetLanguages } = req.body;
        // Validate required fields
        if (!speakerId || !originalText || !sourceLanguage || !targetLanguages) {
            res.status(400).json({
                error: 'Missing required fields',
            });
            return;
        }
        // Submit as final
        const jobId = await (0, processing_queue_1.submitProcessingJob)({
            meetingId,
            speakerId,
            originalText,
            sourceLanguage,
            targetLanguages,
            isFinal: true,
        });
        res.status(202).json({
            jobId,
            status: 'queued',
            type: 'final',
        });
    }
    catch (err) {
        logger_1.logger.error('Failed to submit final translation job', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to submit translation job',
        });
    }
});
/**
 * POST /api/meetings/:meetingId/translate/batch
 * Batch submit multiple translation jobs
 */
exports.translationRouter.post('/meetings/:meetingId/translate/batch', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { jobs } = req.body;
        // Validate
        if (!Array.isArray(jobs) || jobs.length === 0) {
            res.status(400).json({
                error: 'jobs must be a non-empty array',
            });
            return;
        }
        // Submit all jobs
        const jobIds = [];
        const errors = [];
        for (let i = 0; i < jobs.length; i++) {
            try {
                const job = jobs[i];
                const jobId = await (0, processing_queue_1.submitProcessingJob)({
                    meetingId,
                    speakerId: job.speakerId,
                    originalText: job.originalText,
                    sourceLanguage: job.sourceLanguage,
                    targetLanguages: job.targetLanguages,
                    isFinal: job.isFinal || false,
                });
                jobIds.push(jobId);
            }
            catch (err) {
                errors.push({
                    index: i,
                    error: err instanceof Error ? err.message : 'Failed to submit job',
                });
            }
        }
        res.status(202).json({
            jobIds,
            submitted: jobIds.length,
            failed: errors.length,
            errors: errors.length > 0 ? errors : undefined,
            message: `${jobIds.length} of ${jobs.length} jobs queued for processing`,
        });
    }
    catch (err) {
        logger_1.logger.error('Failed to submit batch translation jobs', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to submit translation jobs',
        });
    }
});
exports.default = exports.translationRouter;
//# sourceMappingURL=translation.routes.js.map