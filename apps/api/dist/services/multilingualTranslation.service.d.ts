interface TranslationCacheEntry {
    text: string;
    targetLanguage: string;
    translation: string;
    timestamp: Date;
}
interface ParticipantLanguagePreference {
    userId: string;
    language: string;
}
declare class MultilingualTranslationPipeline {
    private translationCache;
    private cacheMaxSize;
    private cacheTTLMs;
    /**
     * Translate text to all required participant languages
     * Optimized: translate once per language, cache results
     */
    translateToParticipants(text: string, sourceLang: string, meetingId: string): Promise<{
        originalText: string;
        sourceLanguage: string;
        translations: Record<string, string>;
        targetLanguages: string[];
    }>;
    /**
     * Get all unique languages spoken in a meeting (excluding source language)
     */
    private getUniqueParticipantLanguages;
    /**
     * Get cached translation if available and fresh
     */
    private getCachedTranslation;
    /**
     * Cache a translation result
     */
    private cacheTranslation;
    /**
     * Build cache key from text and target language
     */
    private buildCacheKey;
    /**
     * Simple hash function for cache keys
     */
    private simpleHash;
    /**
     * Clear translation cache (for testing or manual invalidation)
     */
    clearCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        maxSize: number;
        currentSize: number;
        ttlMs: number;
    };
    /**
     * Get list of commonly spoken languages in a meeting
     */
    getMeetingLanguageStatistics(meetingId: string): Promise<Array<{
        language: string;
        speakerCount: number;
    }>>;
}
export declare const multilingualTranslationPipeline: MultilingualTranslationPipeline;
export type { TranslationCacheEntry, ParticipantLanguagePreference };
//# sourceMappingURL=multilingualTranslation.service.d.ts.map