// ============================================================
// OrgsLedger API — Translation Worker (Scaled)
// Production-grade multilingual translation worker
// Subscribes to SHARDED translation-jobs queues
// Supports 50k+ concurrent meetings via horizontal scaling
//
// Scaling features:
//   - Subscribes to ALL 16 translation shards
//   - CPU-based dynamic concurrency (CPU_CORES * 2)
//   - No rate limiter (rely on AI rate guard instead)
//   - Worker identity for distributed tracing
//
// Environment Variables:
//   TRANSLATION_PROVIDER=deepl|google|mock
//   TRANSLATION_LANGUAGES=es,fr,de,pt,zh (comma-separated)
//   DEEPL_API_KEY=your-deepl-api-key
//   GOOGLE_APPLICATION_CREDENTIALS=path-to-credentials.json
//   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
//
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import {
  queueManager,
  initializeQueueManager,
  SHARDED_QUEUE_TYPES,
  TranslationJobData,
  submitBroadcast,
  moveToDeadLetter,
} from '../queues/queue-manager';
import { config } from '../config';
import { recordTranslationUsage } from '../monitoring/ai-cost.monitor';
import { incrementTranslationsGenerated } from '../monitoring/meeting-metrics';
import { 
  guardTranslationRequest,
  isTranslationRateLimited,
} from '../monitoring/ai-rate-limit.guard';
import {
  WORKER_ID,
  WORKER_CONCURRENCY,
  logWorkerIdentity,
} from '../scaling/worker-identity';
import {
  getTranslationIdempotencyKey,
  checkAndMarkProcessed,
} from './idempotency';

// ── Types ───────────────────────────────────────────────────

/**
 * Input payload from transcript worker or Deepgram transcription.
 * This is the expected format coming from the translation-jobs queue.
 * 
 * NOTE: Uses 'text' field to match TranslationJobData in queue-manager.ts
 */
export interface TranslationJobPayload {
  meetingId: string;
  speakerId: string;
  text: string; // The text to translate (was: transcript)
  timestamp: number | string;
  // Optional enrichment from Stage 3
  speaker?: string;
  confidence?: number;
  isFinal?: boolean;
  sourceLanguage?: string; // Optional: if known from Deepgram
}

/**
 * Output payload sent to broadcast-events queue.
 */
export interface CaptionBroadcastPayload {
  meetingId: string;
  speakerId: string;
  originalText: string;
  translatedText: string;
  language: string;
  sourceLanguage?: string;
  timestamp: number;
}

/**
 * Translation result for a single target language.
 */
interface TranslationResult {
  targetLanguage: string;
  translatedText: string;
  durationMs: number;
}

/**
 * Language detection result.
 */
interface LanguageDetectionResult {
  language: string;
  confidence: number;
}

// ── Language Detection ──────────────────────────────────────

/**
 * Detect source language using franc library.
 * Falls back to 'en' if detection fails or confidence is low.
 */
async function detectLanguage(text: string): Promise<LanguageDetectionResult> {
  try {
    // @ts-ignore - franc is an optional dependency
    const { franc } = await import('franc');
    
    // franc returns ISO 639-3 codes, we convert to ISO 639-1
    const iso639_3To1: Record<string, string> = {
      eng: 'en', spa: 'es', fra: 'fr', deu: 'de', por: 'pt',
      zho: 'zh', jpn: 'ja', kor: 'ko', ara: 'ar', rus: 'ru',
      ita: 'it', nld: 'nl', pol: 'pl', tur: 'tr', hin: 'hi',
      vie: 'vi', tha: 'th', ind: 'id', ces: 'cs', swe: 'sv',
      dan: 'da', fin: 'fi', nor: 'no', hun: 'hu', ron: 'ro',
      ukr: 'uk', heb: 'he', ell: 'el', cat: 'ca', bul: 'bg',
    };
    
    const detected = franc(text, { minLength: 3 });
    
    if (detected === 'und') {
      // Unable to determine - default to English
      return { language: 'en', confidence: 0.3 };
    }
    
    const iso1Code = iso639_3To1[detected] || 'en';
    
    return { language: iso1Code, confidence: 0.85 };
  } catch (err) {
    // franc not installed - try alternative detection
    return detectLanguageFallback(text);
  }
}

/**
 * Simple heuristic fallback for language detection.
 * Uses character analysis and common patterns.
 */
function detectLanguageFallback(text: string): LanguageDetectionResult {
  // Check for non-Latin scripts
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return { language: 'zh', confidence: 0.9 }; // Chinese
  }
  if (/[\u3040-\u30FF]/.test(text)) {
    return { language: 'ja', confidence: 0.9 }; // Japanese
  }
  if (/[\uAC00-\uD7AF]/.test(text)) {
    return { language: 'ko', confidence: 0.9 }; // Korean
  }
  if (/[\u0600-\u06FF]/.test(text)) {
    return { language: 'ar', confidence: 0.9 }; // Arabic
  }
  if (/[\u0400-\u04FF]/.test(text)) {
    return { language: 'ru', confidence: 0.8 }; // Cyrillic (Russian)
  }
  if (/[\u0370-\u03FF]/.test(text)) {
    return { language: 'el', confidence: 0.9 }; // Greek
  }
  if (/[\u0590-\u05FF]/.test(text)) {
    return { language: 'he', confidence: 0.9 }; // Hebrew
  }
  if (/[\u0900-\u097F]/.test(text)) {
    return { language: 'hi', confidence: 0.9 }; // Hindi
  }
  
  // Default to English for Latin scripts
  return { language: 'en', confidence: 0.5 };
}

// ── Payload Validation ──────────────────────────────────────

/**
 * Validate the job payload structure.
 * Throws descriptive error if validation fails.
 */
function validatePayload(data: unknown): asserts data is TranslationJobPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid payload: expected an object');
  }
  
  const payload = data as Record<string, unknown>;
  
  // Required fields
  if (typeof payload.meetingId !== 'string' || !payload.meetingId) {
    throw new Error('Invalid payload: meetingId must be a non-empty string');
  }
  if (typeof payload.speakerId !== 'string' || !payload.speakerId) {
    throw new Error('Invalid payload: speakerId must be a non-empty string');
  }
  if (typeof payload.text !== 'string' || !payload.text) {
    throw new Error('Invalid payload: text must be a non-empty string');
  }
  if (typeof payload.timestamp !== 'number' || isNaN(payload.timestamp)) {
    throw new Error('Invalid payload: timestamp must be a valid number');
  }
}

// ── Worker Class ────────────────────────────────────────────

class TranslationWorker {
  private workers: Worker<TranslationJobPayload>[] = [];
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;
  private translationCache = new Map<string, string>(); // Simple cache
  private maxCacheSize = 10000;

  /**
   * Initialize the translation worker.
   */
  async initialize(): Promise<void> {
    try {
      // Initialize queue manager first
      await initializeQueueManager();
      
      const connection = createBullMQConnection();
      const concurrency = WORKER_CONCURRENCY.translation();
      const provider = config.translation?.provider || 'mock';
      const targetLanguages = this.getTargetLanguages();
      
      // Get all sharded queues for translation processing
      const queues = queueManager.getAllTranslationQueues();

      logWorkerIdentity('TRANSLATION_WORKER');
      logger.info('[TRANSLATION_WORKER] Starting workers for all shards', {
        workerId: WORKER_ID,
        shardCount: queues.length,
        concurrencyPerShard: concurrency,
        totalConcurrency: concurrency * queues.length,
        provider,
        targetLanguages,
      });

      // Create a worker for EACH shard queue
      for (const queue of queues) {
        const worker = new Worker<TranslationJobPayload>(
          queue.name,
          async (job: Job<TranslationJobPayload>) => {
            return this.processTranslationJob(job);
          },
          {
            connection: connection as any,
            concurrency,
            maxStalledCount: 3,
            stalledInterval: 30000,
            lockDuration: 60000, // Translation API calls can be slow
            // Removed limiter - rely on AI rate guard instead
          }
        );

        this.setupWorkerEventHandlers(worker, queue.name);
        this.workers.push(worker);
      }

      this.isRunning = true;
      logger.info('[TRANSLATION_WORKER] All shard workers initialized', {
        workerId: WORKER_ID,
        workerCount: this.workers.length,
        concurrency,
        provider,
      });
    } catch (err) {
      logger.error('[TRANSLATION_WORKER] Failed to initialize', { error: err });
      throw err;
    }
  }

  /**
   * Set up worker event handlers for a shard.
   */
  private setupWorkerEventHandlers(worker: Worker<TranslationJobPayload>, queueName: string): void {
    worker.on('ready', () => {
      logger.debug('[TRANSLATION_WORKER] Shard ready', { 
        queue: queueName,
        workerId: WORKER_ID,
      });
    });

    worker.on('error', (err: Error) => {
      logger.error('[TRANSLATION_WORKER] Worker error', { 
        queue: queueName,
        error: err.message,
        workerId: WORKER_ID,
      });
    });

    worker.on('failed', async (job, err: Error) => {
      this.failedCount++;
      const maxAttempts = job?.opts?.attempts || 3;
      const attemptsMade = job?.attemptsMade || 0;
      
      logger.warn('[TRANSLATION_WORKER] Job failed', {
        jobId: job?.id,
        meetingId: job?.data?.meetingId,
        queue: queueName,
        attemptsMade,
        maxAttempts,
        error: err.message,
        workerId: WORKER_ID,
      });

      // Move to DLQ after max attempts exhausted
      if (job && attemptsMade >= maxAttempts) {
        try {
          await moveToDeadLetter(
            SHARDED_QUEUE_TYPES.TRANSLATION_JOBS,
            job,
            err.message
          );
        } catch (dlqErr) {
          logger.error('[TRANSLATION_WORKER] Failed to move job to DLQ', {
            jobId: job.id,
            error: dlqErr,
          });
        }
      }
    });

    worker.on('completed', (job, result) => {
      this.processedCount++;
      logger.debug('[TRANSLATION_WORKER] Job completed', {
        jobId: job.id,
        meetingId: job.data.meetingId,
        queue: queueName,
        translationsCount: (result as any)?.translations?.length || 0,
      });
    });

    worker.on('stalled', (jobId) => {
      logger.warn('[TRANSLATION_WORKER] Job stalled', {
        jobId,
        queue: queueName,
        workerId: WORKER_ID,
      });
    });
  }

  /**
   * Get target languages from config or environment.
   */
  private getTargetLanguages(): string[] {
    // Priority: TRANSLATION_LANGUAGES env var > config > default
    const envLangs = process.env.TRANSLATION_LANGUAGES;
    if (envLangs) {
      return envLangs.split(',').map(l => l.trim().toLowerCase()).filter(Boolean);
    }
    return config.translation?.targetLanguages || ['es', 'fr', 'de', 'pt', 'zh'];
  }

  /**
   * Process a translation job.
   * 1. Validate payload
   * 2. Detect source language
   * 3. Translate to all target languages
   * 4. Push each translation to broadcast queue
   */
  private async processTranslationJob(
    job: Job<TranslationJobPayload>
  ): Promise<{ success: boolean; translations: TranslationResult[]; totalDurationMs: number; skipped?: boolean; skipReason?: string }> {
    const startTime = Date.now();
    const translations: TranslationResult[] = [];

    try {
      // Step 1: Validate payload
      validatePayload(job.data);
      
      const { meetingId, speakerId, text, timestamp } = job.data;

      // Step 1.5: Idempotency check for each target language
      // Check if we've already processed this specific translation
      const targetLanguages = this.getTargetLanguages();
      const idempotencyKey = getTranslationIdempotencyKey(
        meetingId,
        speakerId,
        String(timestamp),
        targetLanguages.join(',')
      );
      
      const isDuplicate = await checkAndMarkProcessed(idempotencyKey, 'TRANSLATION_WORKER');
      if (isDuplicate) {
        logger.debug('[TRANSLATION_WORKER] Duplicate event skipped', {
          jobId: job.id,
          meetingId,
          timestamp,
        });
        return {
          success: true,
          translations: [],
          totalDurationMs: Date.now() - startTime,
          skipped: true,
          skipReason: 'Duplicate event',
        };
      }

      logger.debug('[TRANSLATION_WORKER] Processing job', {
        jobId: job.id,
        meetingId,
        speakerId,
        textLength: text.length,
        timestamp,
      });

      // Step 2: Detect source language (or use provided one)
      const sourceLanguage = job.data.sourceLanguage || (await detectLanguage(text)).language;

      // Step 3: Target languages already retrieved for idempotency check

      logger.debug('[TRANSLATION_WORKER] Translation config', {
        jobId: job.id,
        sourceLanguage,
        targetLanguages,
      });

      // Step 3.5: Check AI rate limit before translating
      const rateLimitCheck = await guardTranslationRequest(text.length * targetLanguages.length);
      if (!rateLimitCheck.proceed) {
        logger.warn('[TRANSLATION_WORKER] Translation rate limited, skipping job', {
          jobId: job.id,
          meetingId,
          reason: rateLimitCheck.skipReason,
        });
        return {
          success: false,
          translations: [],
          totalDurationMs: Date.now() - startTime,
          skipped: true,
          skipReason: rateLimitCheck.skipReason,
        };
      }

      // Step 4: Translate to each target language (in parallel with rate limiting)
      const translationPromises = targetLanguages
        .filter(lang => lang !== sourceLanguage) // Skip source language
        .map(async (targetLang) => {
          const translationStart = Date.now();
          
          try {
            // Check rate limit for individual translation
            const individualCheck = await guardTranslationRequest(text.length);
            if (!individualCheck.proceed) {
              logger.warn('[TRANSLATION_WORKER] Translation skipped due to rate limit', {
                jobId: job.id,
                targetLang,
                reason: individualCheck.skipReason,
              });
              return null;
            }

            const translatedText = await this.translate(text, sourceLanguage, targetLang);
            
            const result: TranslationResult = {
              targetLanguage: targetLang,
              translatedText,
              durationMs: Date.now() - translationStart,
            };

            // Step 5: Push to broadcast queue
            await submitBroadcast({
              meetingId,
              eventType: 'translation',
              data: {
                meetingId,
                speakerId,
                originalText: text,
                translatedText,
                language: targetLang,
                sourceLanguage,
                timestamp,
              } as CaptionBroadcastPayload,
            });

            logger.debug('[TRANSLATION_WORKER] Translation completed', {
              jobId: job.id,
              targetLang,
              durationMs: result.durationMs,
            });

            return result;
          } catch (err: any) {
            logger.error('[TRANSLATION_WORKER] Single translation failed', {
              jobId: job.id,
              targetLang,
              error: err.message,
            });
            // Don't fail the entire job for one language failure
            return null;
          }
        });

      const results = await Promise.all(translationPromises);
      const successfulTranslations = results.filter((r): r is TranslationResult => r !== null);
      translations.push(...successfulTranslations);

      const totalDurationMs = Date.now() - startTime;

      // Record translation usage to AI cost monitor
      if (successfulTranslations.length > 0) {
        try {
          const targetLangs = successfulTranslations.map(t => t.targetLanguage);
          recordTranslationUsage(
            text.length,
            successfulTranslations.length,
            targetLangs,
            meetingId
          );
        } catch (costErr) {
          logger.warn('[TRANSLATION_WORKER] Failed to record translation cost', { error: costErr });
        }

        // Increment meeting pipeline metrics (non-blocking)
        incrementTranslationsGenerated(meetingId).catch(() => {});
      }

      logger.info('[TRANSLATION_WORKER] Job processed', {
        jobId: job.id,
        meetingId,
        sourceLanguage,
        translationsCount: translations.length,
        totalDurationMs,
      });

      return { success: true, translations, totalDurationMs };
    } catch (err: any) {
      logger.error('[TRANSLATION_WORKER] Job processing failed', {
        jobId: job.id,
        error: err.message,
        stack: err.stack,
      });
      throw err; // Re-throw for BullMQ retry mechanism
    }
  }

  /**
   * Translate text using configured provider.
   */
  private async translate(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    // Check cache first
    const cacheKey = `${sourceLang}:${targetLang}:${text.substring(0, 100)}`;
    const cached = this.translationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const provider = config.translation?.provider || 'mock';
    let translated: string;

    switch (provider) {
      case 'google':
        translated = await this.translateWithGoogle(text, sourceLang, targetLang);
        break;
      case 'deepl':
        translated = await this.translateWithDeepL(text, sourceLang, targetLang);
        break;
      default:
        // Mock translation for development
        translated = this.mockTranslate(text, targetLang);
    }

    // Update cache (with size limit)
    if (this.translationCache.size >= this.maxCacheSize) {
      // Remove oldest entries (simple approach)
      const keys = Array.from(this.translationCache.keys()).slice(0, 1000);
      keys.forEach(key => this.translationCache.delete(key));
    }
    this.translationCache.set(cacheKey, translated);

    return translated;
  }

  /**
   * Translate using Google Cloud Translation API.
   */
  private async translateWithGoogle(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    try {
      // @ts-ignore - google-cloud/translate is optional
      const { Translate } = await import('@google-cloud/translate').then(m => m.v2);
      const translate = new Translate();

      const [translation] = await translate.translate(text, {
        from: sourceLang.split('-')[0],
        to: targetLang.split('-')[0],
      });

      return translation;
    } catch (err: any) {
      logger.error('[TRANSLATION_WORKER] Google Translate failed', {
        error: err.message,
        sourceLang,
        targetLang,
      });
      throw new Error(`Google Translate error: ${err.message}`);
    }
  }

  /**
   * Translate using DeepL API.
   */
  private async translateWithDeepL(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPL_API_KEY environment variable not set');
    }

    try {
      // @ts-ignore - deepl-node is optional
      const deepl = await import('deepl-node');
      const translator = new deepl.Translator(apiKey);

      // DeepL uses uppercase language codes for target
      const result = await translator.translateText(
        text,
        sourceLang.split('-')[0].toLowerCase() as any,
        targetLang.toUpperCase() as any
      );

      return result.text;
    } catch (err: any) {
      logger.error('[TRANSLATION_WORKER] DeepL failed', {
        error: err.message,
        sourceLang,
        targetLang,
      });
      throw new Error(`DeepL error: ${err.message}`);
    }
  }

  /**
   * Mock translation for development/testing.
   */
  private mockTranslate(text: string, targetLang: string): string {
    // Simulate network delay
    return `[${targetLang.toUpperCase()}] ${text}`;
  }

  /**
   * Get worker statistics.
   */
  getStats(): { 
    running: boolean; 
    processed: number; 
    failed: number; 
    cacheSize: number;
    workerId: string;
    workerCount: number;
  } {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
      cacheSize: this.translationCache.size,
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    };
  }

  /**
   * Gracefully stop all shard workers.
   */
  async stop(): Promise<void> {
    logger.info('[TRANSLATION_WORKER] Stopping all shard workers...', {
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    });
    
    // Close all shard workers in parallel
    await Promise.all(
      this.workers.map(worker => worker.close())
    );
    this.workers = [];
    this.isRunning = false;
    this.translationCache.clear();
    
    logger.info('[TRANSLATION_WORKER] All workers stopped', {
      workerId: WORKER_ID,
      processedTotal: this.processedCount,
      failedTotal: this.failedCount,
    });
  }
}

// ── Singleton Instance ──────────────────────────────────────

let translationWorker: TranslationWorker | null = null;

export async function startTranslationWorker(): Promise<void> {
  if (!translationWorker) {
    translationWorker = new TranslationWorker();
  }
  await translationWorker.initialize();
}

export async function stopTranslationWorker(): Promise<void> {
  if (translationWorker) {
    await translationWorker.stop();
    translationWorker = null;
  }
}

export function getTranslationWorker(): TranslationWorker | null {
  return translationWorker;
}

// ── Test Job Helper (for development) ───────────────────────

/**
 * Submit a test translation job for development/debugging.
 * Usage: import { submitTestTranslationJob } from './translation.worker';
 *        await submitTestTranslationJob('meeting-123', 'user-456', 'Hello, world!');
 */
export async function submitTestTranslationJob(
  meetingId: string,
  speakerId: string,
  text: string
): Promise<Job<TranslationJobData>> {
  // Use queue-manager for sharded queue submission
  const { submitTranslation, initializeQueueManager } = await import('../queues/queue-manager');
  await initializeQueueManager();
  
  return submitTranslation({
    meetingId,
    speaker: 'Test Speaker',
    speakerId,
    text,
    timestamp: new Date().toISOString(),
    sourceLanguage: 'en',
    targetLanguages: config.translation?.targetLanguages || ['es', 'fr', 'de'],
  });
}
