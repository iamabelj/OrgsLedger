"use strict";
// ============================================================
// OrgsLedger API — Multilingual Translation Pipeline
// Translate once per language, cache, broadcast to participants
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.multilingualTranslationPipeline = void 0;
const db_1 = require("../db");
const logger_1 = require("../logger");
const translation_service_1 = require("./translation.service");
class MultilingualTranslationPipeline {
    translationCache = new Map();
    cacheMaxSize = 1000;
    cacheTTLMs = 3600000; // 1 hour
    /**
     * Translate text to all required participant languages
     * Optimized: translate once per language, cache results
     */
    async translateToParticipants(text, sourceLang, meetingId) {
        try {
            // Step 1: Get all unique participant languages in the meeting
            const targetLanguages = await this.getUniqueParticipantLanguages(meetingId, sourceLang);
            if (targetLanguages.length === 0) {
                return {
                    originalText: text,
                    sourceLanguage: sourceLang,
                    translations: {},
                    targetLanguages: [],
                };
            }
            // Step 2: Build translation map (cached or new)
            const translations = {};
            for (const targetLang of targetLanguages) {
                const cached = this.getCachedTranslation(text, targetLang);
                if (cached) {
                    translations[targetLang] = cached;
                    logger_1.logger.debug(`Using cached translation for ${sourceLang}->${targetLang}`);
                }
                else {
                    // Translate using translation service
                    try {
                        const result = await (0, translation_service_1.translateText)(text, sourceLang, targetLang);
                        const translation = result.translatedText;
                        translations[targetLang] = translation;
                        // Cache the translation
                        this.cacheTranslation(text, targetLang, translation);
                        logger_1.logger.info(`Translated ${sourceLang} -> ${targetLang}`, {
                            sourceLength: text.length,
                            targetLength: translation.length,
                        });
                    }
                    catch (err) {
                        logger_1.logger.warn(`Translation failed for ${sourceLang}->${targetLang}`, err);
                        // Fallback: keep source text
                        translations[targetLang] = text;
                    }
                }
            }
            return {
                originalText: text,
                sourceLanguage: sourceLang,
                translations,
                targetLanguages,
            };
        }
        catch (err) {
            logger_1.logger.error('Failed to translate to participants', err);
            return {
                originalText: text,
                sourceLanguage: sourceLang,
                translations: {},
                targetLanguages: [],
            };
        }
    }
    /**
     * Get all unique languages spoken in a meeting (excluding source language)
     */
    async getUniqueParticipantLanguages(meetingId, sourceLang) {
        try {
            // Query meeting participants and their language preferences
            const participants = await (0, db_1.db)('meeting_participants as mp')
                .select('u.id', 'ulp.language')
                .join('users as u', 'mp.user_id', 'u.id')
                .leftJoin('user_language_preferences as ulp', 'u.id', 'ulp.user_id')
                .where('mp.meeting_id', meetingId)
                .where('mp.status', 'in');
            // Extract unique languages, excluding source language and null values
            const languageSet = new Set();
            for (const p of participants) {
                const lang = p.language || 'en'; // Default to English if not set
                if (lang !== sourceLang) {
                    languageSet.add(lang.toLowerCase());
                }
            }
            return Array.from(languageSet);
        }
        catch (err) {
            logger_1.logger.error('Failed to get participant languages', err);
            return [];
        }
    }
    /**
     * Get cached translation if available and fresh
     */
    getCachedTranslation(text, targetLang) {
        const cacheKey = this.buildCacheKey(text, targetLang);
        const entry = this.translationCache.get(cacheKey);
        if (!entry) {
            return null;
        }
        // Check if cache entry is still fresh
        const age = Date.now() - entry.timestamp.getTime();
        if (age > this.cacheTTLMs) {
            this.translationCache.delete(cacheKey);
            return null;
        }
        return entry.translation;
    }
    /**
     * Cache a translation result
     */
    cacheTranslation(text, targetLang, translation) {
        const cacheKey = this.buildCacheKey(text, targetLang);
        // Simple eviction: if cache is full, clear oldest entries
        if (this.translationCache.size >= this.cacheMaxSize) {
            const entriesToDelete = Math.ceil(this.cacheMaxSize * 0.1); // Remove 10%
            let deleted = 0;
            for (const key of this.translationCache.keys()) {
                if (deleted >= entriesToDelete)
                    break;
                this.translationCache.delete(key);
                deleted++;
            }
            logger_1.logger.info(`Evicted ${deleted} entries from translation cache`);
        }
        this.translationCache.set(cacheKey, {
            text,
            targetLanguage: targetLang,
            translation,
            timestamp: new Date(),
        });
    }
    /**
     * Build cache key from text and target language
     */
    buildCacheKey(text, targetLang) {
        // Use hash of text + language to keep cache keys bounded
        const textHash = this.simpleHash(text);
        return `${textHash}:${targetLang}`;
    }
    /**
     * Simple hash function for cache keys
     */
    simpleHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }
    /**
     * Clear translation cache (for testing or manual invalidation)
     */
    clearCache() {
        const size = this.translationCache.size;
        this.translationCache.clear();
        logger_1.logger.info(`Cleared translation cache (${size} entries)`);
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            maxSize: this.cacheMaxSize,
            currentSize: this.translationCache.size,
            ttlMs: this.cacheTTLMs,
        };
    }
    /**
     * Get list of commonly spoken languages in a meeting
     */
    async getMeetingLanguageStatistics(meetingId) {
        try {
            const result = await (0, db_1.db)('meeting_participants as mp')
                .select('ulp.language', db_1.db.raw('COUNT(DISTINCT mp.user_id) as speaker_count'))
                .join('users as u', 'mp.user_id', 'u.id')
                .leftJoin('user_language_preferences as ulp', 'u.id', 'ulp.user_id')
                .where('mp.meeting_id', meetingId)
                .where('mp.status', 'in')
                .groupBy('ulp.language')
                .orderBy('speaker_count', 'desc');
            return result.map((row) => ({
                language: row.language || 'en',
                speakerCount: parseInt(row.speaker_count, 10),
            }));
        }
        catch (err) {
            logger_1.logger.error('Failed to get meeting language statistics', err);
            return [];
        }
    }
}
// Export singleton instance
exports.multilingualTranslationPipeline = new MultilingualTranslationPipeline();
//# sourceMappingURL=multilingualTranslation.service.js.map