export declare const SUPPORTED_LANGUAGES: Record<string, string>;
export declare const SPEECH_RECOGNITION_CODES: Record<string, string>;
interface TranslationResult {
    translatedText: string;
    detectedSourceLanguage?: string;
}
/**
 * Translate text using Google Cloud Translation API v2.
 * Falls back to the AI proxy if configured, then to Google directly.
 */
export declare function translateText(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult>;
/**
 * Translate text to multiple target languages in one batch.
 * Returns a map of langCode → translatedText.
 */
export declare function translateToMultiple(text: string, targetLangs: string[], sourceLang?: string): Promise<Record<string, string>>;
export {};
//# sourceMappingURL=translation.service.d.ts.map