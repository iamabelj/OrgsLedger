export interface Language {
    code: string;
    name: string;
    nativeName: string;
    rtl?: boolean;
    flag?: string;
    bcp47?: string;
}
/** All languages, sorted alphabetically by English name */
export declare const ALL_LANGUAGES: Language[];
/** Quick lookup: code → Language object */
export declare function getLanguage(code: string): Language | undefined;
/** code → English name (returns code itself if unknown) */
export declare function getLanguageName(code: string): string;
/** code → native name */
export declare function getLanguageNativeName(code: string): string;
/** code → emoji flag */
export declare function getLanguageFlag(code: string): string;
/** code → BCP-47 tag for Speech APIs */
export declare function getBcp47(code: string): string;
/** code → whether script is RTL */
export declare function isRtl(code: string): boolean;
/** Returns all ISO codes as a flat array */
export declare function getAllCodes(): string[];
/** Flat maps used for backward compat with old LANGUAGES / LANG_FLAGS / SPEECH_CODES */
export declare const LANGUAGES: Record<string, string>;
export declare const LANG_FLAGS: Record<string, string>;
export declare const SPEECH_CODES: Record<string, string>;
export declare const TTS_SUPPORTED: Set<string>;
/** Check whether TTS is available for a language */
export declare function isTtsSupported(code: string): boolean;
export interface UserLanguagePreference {
    userId: string;
    preferredLanguage: string;
    receiveVoice: boolean;
    receiveText: boolean;
}
//# sourceMappingURL=languages.d.ts.map