// ============================================================
// OrgsLedger API — Translation Controller
// HTTP endpoints for translation requests
// Submits jobs to processing queue for async handling
// ============================================================

import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { submitProcessingJob } from '../meeting-pipeline';

export const translationRouter = Router();

/**
 * POST /api/meetings/:meetingId/translate
 * Submit translation job for STT output
 */
translationRouter.post(
  '/meetings/:meetingId/translate',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { meetingId } = req.params;
      const {
        speakerId,
        originalText,
        sourceLanguage,
        targetLanguages,
        isFinal = false,
      } = req.body;

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
      const jobId = await submitProcessingJob({
        meetingId,
        speakerId,
        originalText,
        sourceLanguage,
        targetLanguages,
        isFinal,
      });

      logger.debug('Translation job submitted', {
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
    } catch (err) {
      logger.error('Failed to submit translation job', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to submit translation job',
      });
    }
  }
);

/**
 * POST /api/meetings/:meetingId/translate/interim
 * Submit interim translation (for streaming/partial results)
 */
translationRouter.post(
  '/meetings/:meetingId/translate/interim',
  async (req: Request, res: Response): Promise<void> => {
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
      const jobId = await submitProcessingJob({
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
    } catch (err) {
      logger.error('Failed to submit interim translation job', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to submit translation job',
      });
    }
  }
);

/**
 * POST /api/meetings/:meetingId/translate/final
 * Submit final translation
 */
translationRouter.post(
  '/meetings/:meetingId/translate/final',
  async (req: Request, res: Response): Promise<void> => {
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
      const jobId = await submitProcessingJob({
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
    } catch (err) {
      logger.error('Failed to submit final translation job', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to submit translation job',
      });
    }
  }
);

/**
 * POST /api/meetings/:meetingId/translate/batch
 * Batch submit multiple translation jobs
 */
translationRouter.post(
  '/meetings/:meetingId/translate/batch',
  async (req: Request, res: Response): Promise<void> => {
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
      const jobIds: string[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < jobs.length; i++) {
        try {
          const job = jobs[i];
          const jobId = await submitProcessingJob({
            meetingId,
            speakerId: job.speakerId,
            originalText: job.originalText,
            sourceLanguage: job.sourceLanguage,
            targetLanguages: job.targetLanguages,
            isFinal: job.isFinal || false,
          });

          jobIds.push(jobId);
        } catch (err) {
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
    } catch (err) {
      logger.error('Failed to submit batch translation jobs', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to submit translation jobs',
      });
    }
  }
);

export default translationRouter;
