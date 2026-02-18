export { LANGUAGES, LANG_FLAGS, SPEECH_CODES, TTS_SUPPORTED, isTtsSupported, ALL_LANGUAGES, getLanguage, getLanguageName, getLanguageFlag, getBcp47, isRtl, getAllCodes, } from '@orgsledger/shared';
export type { Language, UserLanguagePreference } from '@orgsledger/shared';
interface TranslationResult {
    translatedText: string;
    detectedSourceLanguage?: string;
}
/**
 * Translate text using GPT-4o-mini (primary) or fallback chain.
 * Accepts ANY ISO language code — no pre-defined list required.
 */
export declare function translateText(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult>;
/**
 * Translate text to multiple target languages in one batch.
 * Routes each language through translateText (with cache).
 * Returns a map of langCode → translatedText.
 */
export declare function translateToMultiple(text: string, targetLangs: string[], sourceLang?: string): Promise<Record<string, string>>;
//# sourceMappingURL=translation.service.d.ts.map