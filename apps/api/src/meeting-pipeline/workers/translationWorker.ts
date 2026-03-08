// ============================================================
// OrgsLedger — Translation Worker
// Consumes transcript-events, translates using GPT-4o-mini
// Caches translations in Redis
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection, getRedisClient } from '../../infrastructure/redisClient';
import { logger } from '../../logger';
import { TranscriptSegment, TranslationResult } from '../types';
import { meetingStateManager } from '../meetingState';
import { broadcastWorkerManager } from './broadcastWorker';
import OpenAI from 'openai';
import { db } from '../../db';
import { deductTranslationWallet, getTranslationWallet } from '../../services/subscription.service';

const QUEUE_NAME = 'translation-queue';
const WORKER_NAME = 'translation-worker';
const CONCURRENCY = 10;
const CACHE_TTL = 86400; // 24 hours
const TRANSLATION_TIMEOUT = 10000; // 10 seconds

// Redis cache key
const CACHE_KEY = (text: string, src: string, tgt: string) =>
  `trans:${src}:${tgt}:${Buffer.from(text).toString('base64').slice(0, 40)}`;

class TranslationWorkerManager {
  private worker: Worker<TranscriptSegment> | null = null;
  private openai: OpenAI | null = null;
  private isRunning = false;
  private translatedCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Initialize the translation worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      logger.warn('[TRANSLATION_WORKER] Already initialized');
      return;
    }

    try {
      // Initialize OpenAI client
      if (process.env.OPENAI_API_KEY) {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      } else {
        logger.warn('[TRANSLATION_WORKER] OPENAI_API_KEY not set - translations disabled');
      }

      const redis = createBullMQConnection();

      this.worker = new Worker<TranscriptSegment>(
        QUEUE_NAME,
        async (job: Job<TranscriptSegment>) => {
          await this.processSegment(job.data);
        },
        {
          connection: redis as any,
          concurrency: CONCURRENCY,
          name: WORKER_NAME,
          lockDuration: 30000,
          lockRenewTime: 15000,
        }
      );

      this.worker.on('ready', () => {
        this.isRunning = true;
        logger.info('[TRANSLATION_WORKER] Ready', { concurrency: CONCURRENCY });
      });

      this.worker.on('error', (err) => {
        logger.error('[TRANSLATION_WORKER] Error', err);
      });

      logger.info('[TRANSLATION_WORKER] Initialized');
    } catch (err) {
      logger.error('[TRANSLATION_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process a transcript segment for translation
   */
  private async processSegment(segment: TranscriptSegment): Promise<void> {
    // Only translate final segments
    if (!segment.isFinal) return;

    // Skip empty or very short text
    if (!segment.text || segment.text.trim().length < 2) return;

    const startTime = Date.now();

    try {
      // Get target languages for this meeting
      const targetLanguages = await meetingStateManager.getTargetLanguages(
        segment.meetingId,
        segment.language // Exclude source language
      );

      const sourceLanguage = segment.language || 'en';
      const timestampMs = Date.parse(segment.timestamp) || Date.now();

      const organizationId = await this.resolveOrganizationId(segment);

      // Always include source language (so clients can render even without translations)
      const translations: Record<string, string> = { [sourceLanguage]: segment.text };
      let fromCache = true;

      if (targetLanguages.length === 0) {
        logger.debug('[TRANSLATION_WORKER] No target languages; broadcasting original only', {
          meetingId: segment.meetingId,
        });
      }

      if (targetLanguages.length > 0 && this.openai) {
        // Enforce translation wallet when organizationId is known.
        if (organizationId) {
          const wallet = await getTranslationWallet(organizationId);
          const balance = parseFloat(wallet.balance_minutes);
          if (!Number.isFinite(balance) || balance <= 0) {
            logger.warn('[TRANSLATION_WORKER] Wallet empty; broadcasting original only', {
              meetingId: segment.meetingId,
              orgId: organizationId,
            });
            broadcastWorkerManager.broadcastTranslation(
              segment.meetingId,
              segment.speakerId || 'unknown',
              segment.speakerName || 'Unknown',
              segment.text,
              sourceLanguage,
              translations,
              timestampMs,
              segment.isFinal
            );
            return;
          }

          const minutesToDeduct = this.estimateTranslationMinutes(segment.text, targetLanguages.length);
          const deduction = await deductTranslationWallet(
            organizationId,
            minutesToDeduct,
            `Live translation: ${targetLanguages.length} lang(s), ${segment.text.length} chars`
          );
          if (!deduction.success) {
            logger.warn('[TRANSLATION_WORKER] Wallet deduction failed; broadcasting original only', {
              meetingId: segment.meetingId,
              orgId: organizationId,
              error: deduction.error,
            });
            broadcastWorkerManager.broadcastTranslation(
              segment.meetingId,
              segment.speakerId || 'unknown',
              segment.speakerName || 'Unknown',
              segment.text,
              sourceLanguage,
              translations,
              timestampMs,
              segment.isFinal
            );
            return;
          }
        }

        await Promise.all(
          targetLanguages.map(async (targetLang: string) => {
            const translated = await this.translate(
              segment.text,
              sourceLanguage,
              targetLang
            );
            if (translated) {
              translations[targetLang] = translated.text;
              if (!translated.fromCache) fromCache = false;
            }
          })
        );
      } else if (targetLanguages.length > 0 && !this.openai) {
        logger.warn('[TRANSLATION_WORKER] OpenAI not configured; broadcasting original only', {
          meetingId: segment.meetingId,
        });
      }

      const latency = Date.now() - startTime;
      this.translatedCount++;

      // Broadcast translations to clients
      broadcastWorkerManager.broadcastTranslation(
        segment.meetingId,
        segment.speakerId || 'unknown',
        segment.speakerName || 'Unknown',
        segment.text,
        sourceLanguage,
        translations,
        timestampMs,
        segment.isFinal
      );

      logger.debug('[TRANSLATION_WORKER] Translated', {
        meetingId: segment.meetingId,
        languages: Object.keys(translations),
        fromCache,
        latencyMs: latency,
      });
    } catch (err) {
      logger.error('[TRANSLATION_WORKER] Failed to translate', {
        meetingId: segment.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private estimateTranslationMinutes(text: string, targetLanguageCount: number): number {
    // Keep parity with LivekitBot heuristic:
    // speakingSeconds = max(5, ceil(chars / 15)); deductMinutes = (speakingSeconds * langCount) / 60
    const speakingSeconds = Math.max(5, Math.ceil((text || '').length / 15));
    const langMultiplier = Math.max(1, targetLanguageCount || 1);
    const minutes = (speakingSeconds * langMultiplier) / 60;
    return Math.round(minutes * 100) / 100;
  }

  private async resolveOrganizationId(segment: TranscriptSegment): Promise<string | null> {
    if (segment.organizationId && String(segment.organizationId).trim().length > 0) {
      return String(segment.organizationId).trim();
    }

    try {
      const state = await meetingStateManager.getMeeting(segment.meetingId);
      const orgId = state?.organizationId?.trim();
      if (orgId) return orgId;
    } catch {
      // ignore
    }

    try {
      const meeting = await db('meetings')
        .where({ id: segment.meetingId })
        .select('organization_id')
        .first();
      const orgId = meeting?.organization_id ? String(meeting.organization_id).trim() : '';
      return orgId || null;
    } catch {
      return null;
    }
  }

  /**
   * Translate text using cache-first strategy
   */
  private async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<{ text: string; fromCache: boolean } | null> {
    const cacheKey = CACHE_KEY(text, sourceLanguage, targetLanguage);

    try {
      const redis = await getRedisClient();

      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        this.cacheHits++;
        return { text: cached, fromCache: true };
      }

      this.cacheMisses++;

      // Call GPT-4o-mini for translation
      if (!this.openai) {
        logger.warn('[TRANSLATION_WORKER] OpenAI not configured');
        return null;
      }

      const response = await Promise.race([
        this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Return ONLY the translated text, nothing else.`,
            },
            { role: 'user', content: text },
          ],
          max_tokens: 500,
          temperature: 0.3,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Translation timeout')), TRANSLATION_TIMEOUT)
        ),
      ]);

      const translated = response.choices[0]?.message?.content?.trim();
      if (!translated) {
        return null;
      }

      // Cache the translation
      await redis.setex(cacheKey, CACHE_TTL, translated);

      return { text: translated, fromCache: false };
    } catch (err) {
      logger.error('[TRANSLATION_WORKER] Translation API error', {
        source: sourceLanguage,
        target: targetLanguage,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    running: boolean;
    translatedCount: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      running: this.isRunning,
      translatedCount: this.translatedCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: total > 0 ? Math.round((this.cacheHits / total) * 100) : 0,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.isRunning = false;
    logger.info('[TRANSLATION_WORKER] Shut down');
  }
}

export const translationWorkerManager = new TranslationWorkerManager();
