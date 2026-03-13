import { Job } from 'bullmq';
import { TranslationJobData } from '../queues/queue-manager';
/**
 * Input payload from transcript worker or Deepgram transcription.
 * This is the expected format coming from the translation-jobs queue.
 *
 * NOTE: Uses 'text' field to match TranslationJobData in queue-manager.ts
 */
export interface TranslationJobPayload {
    meetingId: string;
    speakerId: string;
    text: string;
    timestamp: number | string;
    speaker?: string;
    confidence?: number;
    isFinal?: boolean;
    sourceLanguage?: string;
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
declare class TranslationWorker {
    private workers;
    private isRunning;
    private processedCount;
    private failedCount;
    private translationCache;
    private maxCacheSize;
    /**
     * Initialize the translation worker.
     */
    initialize(): Promise<void>;
    /**
     * Set up worker event handlers for a shard.
     */
    private setupWorkerEventHandlers;
    /**
     * Get target languages from config or environment.
     */
    private getTargetLanguages;
    /**
     * Process a translation job.
     * 1. Validate payload
     * 2. Detect source language
     * 3. Translate to all target languages
     * 4. Push each translation to broadcast queue
     */
    private processTranslationJob;
    /**
     * Translate text using configured provider.
     */
    private translate;
    /**
     * Translate using Google Cloud Translation API.
     */
    private translateWithGoogle;
    /**
     * Translate using DeepL API.
     */
    private translateWithDeepL;
    /**
     * Mock translation for development/testing.
     */
    private mockTranslate;
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
    };
    /**
     * Gracefully stop all shard workers.
     */
    stop(): Promise<void>;
}
export declare function startTranslationWorker(): Promise<void>;
export declare function stopTranslationWorker(): Promise<void>;
export declare function getTranslationWorker(): TranslationWorker | null;
/**
 * Submit a test translation job for development/debugging.
 * Usage: import { submitTestTranslationJob } from './translation.worker';
 *        await submitTestTranslationJob('meeting-123', 'user-456', 'Hello, world!');
 */
export declare function submitTestTranslationJob(meetingId: string, speakerId: string, text: string): Promise<Job<TranslationJobData>>;
export {};
//# sourceMappingURL=translation.worker.d.ts.map