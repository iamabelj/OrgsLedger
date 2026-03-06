// ============================================================
// OrgsLedger API — Processing Worker Service
// Core business logic for processing translations from queue jobs
// Integrates with translation services and database
// ============================================================

import { logger } from '../../logger';
import { broadcastToQueue } from '../../queues/broadcast.queue';
import { translateText } from '../translation.service';
import { transcriptService } from '../../services/transcript.service';

import { deductTranslationWallet } from '../subscription.service';

export interface ProcessingWorker {
  processTranslation(
    meetingId: string,
    speakerId: string,
    originalText: string,
    sourceLanguage: string,
    targetLanguages: string[],
    isFinal: boolean,
    organizationId?: string
  ): Promise<{ finalTranslations?: Record<string, string>; error?: string }>;
}

/**
 * Service that processes translation jobs from the queue
 */
export class ProcessingWorkerService implements ProcessingWorker {
  private bufferTimeout: Map<string, NodeJS.Timeout>;

  constructor() {
    this.bufferTimeout = new Map();
  }

  /**
   * Process a single translation job
   * Handles both interim ("in-progress") and final translations
   */
  async processTranslation(
    meetingId: string,
    speakerId: string,
    originalText: string,
    sourceLanguage: string,
    targetLanguages: string[],
    isFinal: boolean,
    organizationId?: string
  ): Promise<{ finalTranslations?: Record<string, string>; error?: string }> {
    const processStartTime = Date.now();

    try {
      logger.debug('Processing translation job', {
        meetingId,
        speakerId,
        isFinal,
        textLength: originalText.length,
        targetLanguages,
        organizationId,
      });

      // Initialize interim translations
      const interimTranslations: Record<string, string> = {};
      let finalTranslations: Record<string, string> | undefined;

      // Translate to each target language
      for (const targetLang of targetLanguages) {
        try {
          const result = await translateText(
            originalText,
            targetLang,
            sourceLanguage
          );

          interimTranslations[targetLang] = result.translatedText;
        } catch (err) {
          logger.warn(`Translation failed for language ${targetLang}`, {
            meetingId,
            speakerId,
            targetLang,
            error: err instanceof Error ? err.message : String(err),
          });

          // Store error but continue with other languages
          interimTranslations[targetLang] = '';
        }
      }

      // Emit interim broadcast immediately
      await broadcastToQueue({
        meetingId,
        isFinal: false,
        speakerId,
        speakerName: '', // Will be populated in broadcast worker
        originalText,
        sourceLanguage,
        translations: interimTranslations,
        timestamp: new Date().toISOString(),
      });

      // If final, store to database and broadcast final event
      if (isFinal) {
        finalTranslations = interimTranslations;

        try {
          // Verify translations have content
          const hasValidTranslations = Object.values(interimTranslations).some((t) => t.length > 0);

          if (hasValidTranslations) {
            // Store in transcript
            await transcriptService.addTranscriptEntry(meetingId, {
              speakerId,
              originalText,
              sourceLanguage,
              translations: interimTranslations,
              isFinal: true,
            });

            // Deduct from translation wallet if organization provided
            if (organizationId) {
              try {
                const speakingSeconds = Math.max(5, Math.ceil(originalText.length / 15));
                const langMultiplier = Math.max(1, targetLanguages.length);
                const deductMinutes = (speakingSeconds * langMultiplier) / 60;
                const deduction = await deductTranslationWallet(
                  organizationId,
                  Math.round(deductMinutes * 100) / 100,
                  `Live translation: ${targetLanguages.length} language(s), ${originalText.length} chars in meeting`
                );

                if (!deduction.success) {
                  logger.warn('[TRANSLATION] Wallet deduction failed but translation was processed', {
                    meetingId,
                    orgId: organizationId,
                    deductMinutes,
                  });
                } else {
                  logger.debug('[TRANSLATION] Wallet deducted successfully', {
                    meetingId,
                    orgId: organizationId,
                    deductMinutes,
                  });
                }
              } catch (walletErr) {
                logger.error('[TRANSLATION] Wallet deduction error', {
                  meetingId,
                  orgId: organizationId,
                  error: walletErr instanceof Error ? walletErr.message : String(walletErr),
                });
                // Continue - don't fail translation just because wallet deduction failed
              }
            }

            // Emit final broadcast
            await broadcastToQueue({
              meetingId,
              isFinal: true,
              speakerId,
              speakerName: '',
              originalText,
              sourceLanguage,
              translations: interimTranslations,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (err) {
          logger.error('Failed to store final transcript', {
            meetingId,
            speakerId,
            error: err instanceof Error ? err.message : String(err),
          });

          // Still return translations even if storage failed
        }
      }

      const processingTime = Date.now() - processStartTime;

      logger.debug('Translation processing completed', {
        meetingId,
        speakerId,
        isFinal,
        processingTimeMs: processingTime,
        languagesProcessed: targetLanguages.length,
      });

      return {
        finalTranslations,
      };
    } catch (err) {
      logger.error('Translation processing job failed', {
        meetingId,
        speakerId,
        isFinal,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle speaker left meeting - flush any buffered segments for speaker
   */
  async handleSpeakerDisconnect(meetingId: string, speakerId: string): Promise<void> {
    try {
      const bufferKey = `${meetingId}:${speakerId}`;

      // Clear any pending buffer timeouts
      const timeout = this.bufferTimeout.get(bufferKey);
      if (timeout) {
        clearTimeout(timeout);
        this.bufferTimeout.delete(bufferKey);
      }

      logger.debug('Speaker disconnected, buffer flushed', {
        meetingId,
        speakerId,
      });
    } catch (err) {
      logger.error('Error handling speaker disconnect', {
        meetingId,
        speakerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Cleanup processing worker resources
   */
  async cleanup(): Promise<void> {
    try {
      // Clear all pending timeouts
      this.bufferTimeout.forEach((timeout) => clearTimeout(timeout));
      this.bufferTimeout.clear();

      logger.info('Processing worker service cleaned up');
    } catch (err) {
      logger.error('Error during processing worker cleanup', err);
    }
  }
}
