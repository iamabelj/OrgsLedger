// ── Language Registry (local re-export for Metro compatibility) ──
// The canonical source is packages/shared/src/languages.ts
// This file re-exports from the built dist so Metro can resolve it.

export {
  ALL_LANGUAGES,
  LANGUAGES,
  LANG_FLAGS,
  SPEECH_CODES,
  TTS_SUPPORTED,
  getLanguage,
  getLanguageName,
  getLanguageFlag,
  getBcp47,
  isRtl,
  getAllCodes,
  isTtsSupported,
} from '../../../../packages/shared/dist/languages';

export type { Language, UserLanguagePreference } from '../../../../packages/shared/dist/languages';
