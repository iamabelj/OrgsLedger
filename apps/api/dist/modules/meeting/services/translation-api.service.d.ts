interface LanguageInfo {
    code: string;
    name: string;
    flag?: string;
}
/**
 * Comprehensive list of 150+ world languages with display names and flag emojis.
 * Sorted alphabetically by language name.
 */
export declare const SUPPORTED_LANGUAGES: LanguageInfo[];
declare class TranslationApiService {
    /**
     * Get list of supported languages.
     */
    getLanguages(): LanguageInfo[];
    /**
     * Translate text from source language to target language.
     * Uses configured translation provider (Google, DeepL, or mock).
     */
    translate(text: string, targetLang: string, sourceLang?: string): Promise<{
        translatedText: string;
        sourceLang: string;
        targetLang: string;
    }>;
    /**
     * Translate using Google Cloud Translation API.
     */
    private translateWithGoogle;
    /**
     * Translate using DeepL API.
     */
    private translateWithDeepL;
    /**
     * Translate using MyMemory free API (no API key required).
     * Rate limited to 1000 requests/day but works for development.
     */
    private translateWithFreeApi;
}
export declare const translationApiService: TranslationApiService;
export {};
//# sourceMappingURL=translation-api.service.d.ts.map