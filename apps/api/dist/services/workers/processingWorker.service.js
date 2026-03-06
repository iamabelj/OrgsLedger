"use strict";
// ============================================================
// OrgsLedger API — Processing Worker Service
// Core business logic for processing translations from queue jobs
// Integrates with translation services and database
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingWorkerService = void 0;
const logger_1 = require("../../logger");
const broadcast_queue_1 = require("../../queues/broadcast.queue");
const translation_service_1 = require("../translation.service");
const transcript_service_1 = require("../transcript.service");
const subscription_service_1 = require("../subscription.service");
/**
 * Service that processes translation jobs from the queue
 */
class ProcessingWorkerService {
    bufferTimeout;
    constructor() {
        this.bufferTimeout = new Map();
    }
    /**
     * Process a single translation job
     * Handles both interim ("in-progress") and final translations
     */
    async processTranslation(meetingId, speakerId, originalText, sourceLanguage, targetLanguages, isFinal, organizationId) {
        const processStartTime = Date.now();
        try {
            logger_1.logger.debug('Processing translation job', {
                meetingId,
                speakerId,
                isFinal,
                textLength: originalText.length,
                targetLanguages,
                organizationId,
            });
            // Initialize interim translations
            const interimTranslations = {};
            let finalTranslations;
            // Translate to each target language
            for (const targetLang of targetLanguages) {
                try {
                    const result = await (0, translation_service_1.translateText)(originalText, targetLang, sourceLanguage);
                    interimTranslations[targetLang] = result.translatedText;
                }
                catch (err) {
                    logger_1.logger.warn(`Translation failed for language ${targetLang}`, {
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
            await (0, broadcast_queue_1.broadcastToQueue)({
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
                        await transcript_service_1.transcriptService.addTranscriptEntry(meetingId, {
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
                                const deduction = await (0, subscription_service_1.deductTranslationWallet)(organizationId, Math.round(deductMinutes * 100) / 100, `Live translation: ${targetLanguages.length} language(s), ${originalText.length} chars in meeting`);
                                if (!deduction.success) {
                                    logger_1.logger.warn('[TRANSLATION] Wallet deduction failed but translation was processed', {
                                        meetingId,
                                        orgId: organizationId,
                                        deductMinutes,
                                    });
                                }
                                else {
                                    logger_1.logger.debug('[TRANSLATION] Wallet deducted successfully', {
                                        meetingId,
                                        orgId: organizationId,
                                        deductMinutes,
                                    });
                                }
                            }
                            catch (walletErr) {
                                logger_1.logger.error('[TRANSLATION] Wallet deduction error', {
                                    meetingId,
                                    orgId: organizationId,
                                    error: walletErr instanceof Error ? walletErr.message : String(walletErr),
                                });
                                // Continue - don't fail translation just because wallet deduction failed
                            }
                        }
                        // Emit final broadcast
                        await (0, broadcast_queue_1.broadcastToQueue)({
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
                }
                catch (err) {
                    logger_1.logger.error('Failed to store final transcript', {
                        meetingId,
                        speakerId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    // Still return translations even if storage failed
                }
            }
            const processingTime = Date.now() - processStartTime;
            logger_1.logger.debug('Translation processing completed', {
                meetingId,
                speakerId,
                isFinal,
                processingTimeMs: processingTime,
                languagesProcessed: targetLanguages.length,
            });
            return {
                finalTranslations,
            };
        }
        catch (err) {
            logger_1.logger.error('Translation processing job failed', {
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
    async handleSpeakerDisconnect(meetingId, speakerId) {
        try {
            const bufferKey = `${meetingId}:${speakerId}`;
            // Clear any pending buffer timeouts
            const timeout = this.bufferTimeout.get(bufferKey);
            if (timeout) {
                clearTimeout(timeout);
                this.bufferTimeout.delete(bufferKey);
            }
            logger_1.logger.debug('Speaker disconnected, buffer flushed', {
                meetingId,
                speakerId,
            });
        }
        catch (err) {
            logger_1.logger.error('Error handling speaker disconnect', {
                meetingId,
                speakerId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Cleanup processing worker resources
     */
    async cleanup() {
        try {
            // Clear all pending timeouts
            this.bufferTimeout.forEach((timeout) => clearTimeout(timeout));
            this.bufferTimeout.clear();
            logger_1.logger.info('Processing worker service cleaned up');
        }
        catch (err) {
            logger_1.logger.error('Error during processing worker cleanup', err);
        }
    }
}
exports.ProcessingWorkerService = ProcessingWorkerService;
//# sourceMappingURL=processingWorker.service.js.map