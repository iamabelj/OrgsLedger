// ============================================================
// OrgsLedger — Dynamic ISO Language Registry
// ISO-639-1 + ISO-639-3 comprehensive language support.
// Single source of truth for the entire stack.
// ============================================================

export interface Language {
  code: string;         // ISO-639-1 (or ISO-639-3 for languages without a 2-letter code)
  name: string;         // English name
  nativeName: string;   // Native script display
  rtl?: boolean;        // Right-to-left script
  flag?: string;        // Emoji flag (best-effort, some map to region)
  bcp47?: string;       // BCP-47 code for Speech Recognition / TTS
}

// ── Full ISO-639-1 + selected ISO-639-3 languages ──────────
// 185 languages — every ISO-639-1 code plus key ISO-639-3 additions.
// Sorted alphabetically by English name.
const LANGUAGE_DATA: Language[] = [
  { code: 'aa', name: 'Afar', nativeName: 'Afaraf', flag: '🇩🇯', bcp47: 'aa' },
  { code: 'ab', name: 'Abkhaz', nativeName: 'аҧсуа бызшәа', flag: '🏳️', bcp47: 'ab' },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', flag: '🇿🇦', bcp47: 'af-ZA' },
  { code: 'ak', name: 'Akan', nativeName: 'Akan', flag: '🇬🇭', bcp47: 'ak-GH' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', flag: '🇪🇹', bcp47: 'am-ET' },
  { code: 'an', name: 'Aragonese', nativeName: 'aragonés', flag: '🇪🇸', bcp47: 'an' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true, flag: '🇸🇦', bcp47: 'ar-SA' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', flag: '🇮🇳', bcp47: 'as-IN' },
  { code: 'av', name: 'Avaric', nativeName: 'авар мацӀ', flag: '🏳️', bcp47: 'av' },
  { code: 'ay', name: 'Aymara', nativeName: 'aymar aru', flag: '🇧🇴', bcp47: 'ay' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'azərbaycan dili', flag: '🇦🇿', bcp47: 'az-AZ' },
  { code: 'ba', name: 'Bashkir', nativeName: 'башҡорт теле', flag: '🏳️', bcp47: 'ba' },
  { code: 'be', name: 'Belarusian', nativeName: 'беларуская', flag: '🇧🇾', bcp47: 'be-BY' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'български', flag: '🇧🇬', bcp47: 'bg-BG' },
  { code: 'bh', name: 'Bihari', nativeName: 'भोजपुरी', flag: '🇮🇳', bcp47: 'bh' },
  { code: 'bi', name: 'Bislama', nativeName: 'Bislama', flag: '🇻🇺', bcp47: 'bi' },
  { code: 'bm', name: 'Bambara', nativeName: 'bamanankan', flag: '🇲🇱', bcp47: 'bm' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩', bcp47: 'bn-BD' },
  { code: 'bo', name: 'Tibetan', nativeName: 'བོད་ཡིག', flag: '🏳️', bcp47: 'bo' },
  { code: 'br', name: 'Breton', nativeName: 'brezhoneg', flag: '🇫🇷', bcp47: 'br' },
  { code: 'bs', name: 'Bosnian', nativeName: 'bosanski jezik', flag: '🇧🇦', bcp47: 'bs-BA' },
  { code: 'ca', name: 'Catalan', nativeName: 'català', flag: '🇪🇸', bcp47: 'ca-ES' },
  { code: 'ce', name: 'Chechen', nativeName: 'нохчийн мотт', flag: '🏳️', bcp47: 'ce' },
  { code: 'ch', name: 'Chamorro', nativeName: 'Chamoru', flag: '🇬🇺', bcp47: 'ch' },
  { code: 'co', name: 'Corsican', nativeName: 'corsu', flag: '🇫🇷', bcp47: 'co' },
  { code: 'cr', name: 'Cree', nativeName: 'ᓀᐦᐃᔭᐍᐏᐣ', flag: '🇨🇦', bcp47: 'cr' },
  { code: 'cs', name: 'Czech', nativeName: 'čeština', flag: '🇨🇿', bcp47: 'cs-CZ' },
  { code: 'cu', name: 'Church Slavonic', nativeName: 'ѩзыкъ словѣньскъ', flag: '🏳️', bcp47: 'cu' },
  { code: 'cv', name: 'Chuvash', nativeName: 'чӑваш чӗлхи', flag: '🏳️', bcp47: 'cv' },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', bcp47: 'cy-GB' },
  { code: 'da', name: 'Danish', nativeName: 'dansk', flag: '🇩🇰', bcp47: 'da-DK' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', bcp47: 'de-DE' },
  { code: 'dv', name: 'Divehi', nativeName: 'ދިވެހި', rtl: true, flag: '🇲🇻', bcp47: 'dv' },
  { code: 'dz', name: 'Dzongkha', nativeName: 'རྫོང་ཁ', flag: '🇧🇹', bcp47: 'dz' },
  { code: 'ee', name: 'Ewe', nativeName: 'Eʋegbe', flag: '🇬🇭', bcp47: 'ee' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷', bcp47: 'el-GR' },
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧', bcp47: 'en-US' },
  { code: 'eo', name: 'Esperanto', nativeName: 'Esperanto', flag: '🏳️', bcp47: 'eo' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', bcp47: 'es-ES' },
  { code: 'et', name: 'Estonian', nativeName: 'eesti', flag: '🇪🇪', bcp47: 'et-EE' },
  { code: 'eu', name: 'Basque', nativeName: 'euskara', flag: '🇪🇸', bcp47: 'eu-ES' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', rtl: true, flag: '🇮🇷', bcp47: 'fa-IR' },
  { code: 'ff', name: 'Fula', nativeName: 'Fulfulde', flag: '🇳🇬', bcp47: 'ff' },
  { code: 'fi', name: 'Finnish', nativeName: 'suomi', flag: '🇫🇮', bcp47: 'fi-FI' },
  { code: 'fj', name: 'Fijian', nativeName: 'vosa Vakaviti', flag: '🇫🇯', bcp47: 'fj' },
  { code: 'fo', name: 'Faroese', nativeName: 'føroyskt', flag: '🇫🇴', bcp47: 'fo' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', bcp47: 'fr-FR' },
  { code: 'fy', name: 'Western Frisian', nativeName: 'Frysk', flag: '🇳🇱', bcp47: 'fy' },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', flag: '🇮🇪', bcp47: 'ga-IE' },
  { code: 'gd', name: 'Scottish Gaelic', nativeName: 'Gàidhlig', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', bcp47: 'gd' },
  { code: 'gl', name: 'Galician', nativeName: 'galego', flag: '🇪🇸', bcp47: 'gl-ES' },
  { code: 'gn', name: 'Guarani', nativeName: "Avañe'ẽ", flag: '🇵🇾', bcp47: 'gn' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳', bcp47: 'gu-IN' },
  { code: 'gv', name: 'Manx', nativeName: 'Gaelg', flag: '🇮🇲', bcp47: 'gv' },
  { code: 'ha', name: 'Hausa', nativeName: 'هَوُسَ', flag: '🇳🇬', bcp47: 'ha-NG' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', rtl: true, flag: '🇮🇱', bcp47: 'he-IL' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', bcp47: 'hi-IN' },
  { code: 'ho', name: 'Hiri Motu', nativeName: 'Hiri Motu', flag: '🇵🇬', bcp47: 'ho' },
  { code: 'hr', name: 'Croatian', nativeName: 'hrvatski', flag: '🇭🇷', bcp47: 'hr-HR' },
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl ayisyen', flag: '🇭🇹', bcp47: 'ht' },
  { code: 'hu', name: 'Hungarian', nativeName: 'magyar', flag: '🇭🇺', bcp47: 'hu-HU' },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն', flag: '🇦🇲', bcp47: 'hy-AM' },
  { code: 'hz', name: 'Herero', nativeName: 'Otjiherero', flag: '🇳🇦', bcp47: 'hz' },
  { code: 'ia', name: 'Interlingua', nativeName: 'Interlingua', flag: '🏳️', bcp47: 'ia' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩', bcp47: 'id-ID' },
  { code: 'ie', name: 'Interlingue', nativeName: 'Interlingue', flag: '🏳️', bcp47: 'ie' },
  { code: 'ig', name: 'Igbo', nativeName: 'Asụsụ Igbo', flag: '🇳🇬', bcp47: 'ig-NG' },
  { code: 'ii', name: 'Nuosu', nativeName: 'ꆈꌠ꒿ Nuosuhxop', flag: '🇨🇳', bcp47: 'ii' },
  { code: 'ik', name: 'Inupiaq', nativeName: 'Iñupiaq', flag: '🇺🇸', bcp47: 'ik' },
  { code: 'io', name: 'Ido', nativeName: 'Ido', flag: '🏳️', bcp47: 'io' },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska', flag: '🇮🇸', bcp47: 'is-IS' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', bcp47: 'it-IT' },
  { code: 'iu', name: 'Inuktitut', nativeName: 'ᐃᓄᒃᑎᑐᑦ', flag: '🇨🇦', bcp47: 'iu' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', bcp47: 'ja-JP' },
  { code: 'jv', name: 'Javanese', nativeName: 'basa Jawa', flag: '🇮🇩', bcp47: 'jv-ID' },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული', flag: '🇬🇪', bcp47: 'ka-GE' },
  { code: 'kg', name: 'Kongo', nativeName: 'Kikongo', flag: '🇨🇩', bcp47: 'kg' },
  { code: 'ki', name: 'Kikuyu', nativeName: 'Gĩkũyũ', flag: '🇰🇪', bcp47: 'ki' },
  { code: 'kj', name: 'Kuanyama', nativeName: 'Kuanyama', flag: '🇦🇴', bcp47: 'kj' },
  { code: 'kk', name: 'Kazakh', nativeName: 'қазақ тілі', flag: '🇰🇿', bcp47: 'kk-KZ' },
  { code: 'kl', name: 'Kalaallisut', nativeName: 'kalaallisut', flag: '🇬🇱', bcp47: 'kl' },
  { code: 'km', name: 'Khmer', nativeName: 'ខ្មែរ', flag: '🇰🇭', bcp47: 'km-KH' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳', bcp47: 'kn-IN' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', bcp47: 'ko-KR' },
  { code: 'kr', name: 'Kanuri', nativeName: 'Kanuri', flag: '🇳🇬', bcp47: 'kr' },
  { code: 'ks', name: 'Kashmiri', nativeName: 'कश्मीरी', flag: '🇮🇳', bcp47: 'ks' },
  { code: 'ku', name: 'Kurdish', nativeName: 'Kurdî', flag: '🇮🇶', bcp47: 'ku' },
  { code: 'kv', name: 'Komi', nativeName: 'коми кыв', flag: '🏳️', bcp47: 'kv' },
  { code: 'kw', name: 'Cornish', nativeName: 'Kernewek', flag: '🇬🇧', bcp47: 'kw' },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча', flag: '🇰🇬', bcp47: 'ky-KG' },
  { code: 'la', name: 'Latin', nativeName: 'latine', flag: '🏛️', bcp47: 'la' },
  { code: 'lb', name: 'Luxembourgish', nativeName: 'Lëtzebuergesch', flag: '🇱🇺', bcp47: 'lb' },
  { code: 'lg', name: 'Ganda', nativeName: 'Luganda', flag: '🇺🇬', bcp47: 'lg' },
  { code: 'li', name: 'Limburgish', nativeName: 'Limburgs', flag: '🇳🇱', bcp47: 'li' },
  { code: 'ln', name: 'Lingala', nativeName: 'Lingála', flag: '🇨🇩', bcp47: 'ln' },
  { code: 'lo', name: 'Lao', nativeName: 'ພາສາລາວ', flag: '🇱🇦', bcp47: 'lo-LA' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'lietuvių kalba', flag: '🇱🇹', bcp47: 'lt-LT' },
  { code: 'lu', name: 'Luba-Katanga', nativeName: 'Kiluba', flag: '🇨🇩', bcp47: 'lu' },
  { code: 'lv', name: 'Latvian', nativeName: 'latviešu valoda', flag: '🇱🇻', bcp47: 'lv-LV' },
  { code: 'mg', name: 'Malagasy', nativeName: 'fiteny malagasy', flag: '🇲🇬', bcp47: 'mg' },
  { code: 'mh', name: 'Marshallese', nativeName: 'Kajin M̧ajeļ', flag: '🇲🇭', bcp47: 'mh' },
  { code: 'mi', name: 'Māori', nativeName: 'te reo Māori', flag: '🇳🇿', bcp47: 'mi-NZ' },
  { code: 'mk', name: 'Macedonian', nativeName: 'македонски', flag: '🇲🇰', bcp47: 'mk-MK' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳', bcp47: 'ml-IN' },
  { code: 'mn', name: 'Mongolian', nativeName: 'монгол', flag: '🇲🇳', bcp47: 'mn-MN' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳', bcp47: 'mr-IN' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾', bcp47: 'ms-MY' },
  { code: 'mt', name: 'Maltese', nativeName: 'Malti', flag: '🇲🇹', bcp47: 'mt-MT' },
  { code: 'my', name: 'Burmese', nativeName: 'ဗမာစာ', flag: '🇲🇲', bcp47: 'my-MM' },
  { code: 'na', name: 'Nauru', nativeName: 'Ekakairũ Naoero', flag: '🇳🇷', bcp47: 'na' },
  { code: 'nb', name: 'Norwegian Bokmål', nativeName: 'Norsk bokmål', flag: '🇳🇴', bcp47: 'nb-NO' },
  { code: 'nd', name: 'Northern Ndebele', nativeName: 'isiNdebele', flag: '🇿🇼', bcp47: 'nd' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', flag: '🇳🇵', bcp47: 'ne-NP' },
  { code: 'ng', name: 'Ndonga', nativeName: 'Owambo', flag: '🇳🇦', bcp47: 'ng' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱', bcp47: 'nl-NL' },
  { code: 'nn', name: 'Norwegian Nynorsk', nativeName: 'Norsk nynorsk', flag: '🇳🇴', bcp47: 'nn-NO' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴', bcp47: 'no-NO' },
  { code: 'nr', name: 'Southern Ndebele', nativeName: 'isiNdebele', flag: '🇿🇦', bcp47: 'nr' },
  { code: 'nv', name: 'Navajo', nativeName: 'Diné bizaad', flag: '🇺🇸', bcp47: 'nv' },
  { code: 'ny', name: 'Chichewa', nativeName: 'chiCheŵa', flag: '🇲🇼', bcp47: 'ny' },
  { code: 'oc', name: 'Occitan', nativeName: "occitan, lenga d'òc", flag: '🇫🇷', bcp47: 'oc' },
  { code: 'oj', name: 'Ojibwe', nativeName: 'ᐊᓂᔑᓈᐯᒧᐎᓐ', flag: '🇨🇦', bcp47: 'oj' },
  { code: 'om', name: 'Oromo', nativeName: 'Afaan Oromoo', flag: '🇪🇹', bcp47: 'om' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', flag: '🇮🇳', bcp47: 'or-IN' },
  { code: 'os', name: 'Ossetian', nativeName: 'ирон æвзаг', flag: '🏳️', bcp47: 'os' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳', bcp47: 'pa-IN' },
  { code: 'pi', name: 'Pāli', nativeName: 'पाऴि', flag: '🏳️', bcp47: 'pi' },
  { code: 'pl', name: 'Polish', nativeName: 'polski', flag: '🇵🇱', bcp47: 'pl-PL' },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو', rtl: true, flag: '🇦🇫', bcp47: 'ps-AF' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', bcp47: 'pt-BR' },
  { code: 'qu', name: 'Quechua', nativeName: 'Runa Simi', flag: '🇵🇪', bcp47: 'qu' },
  { code: 'rm', name: 'Romansh', nativeName: 'rumantsch grischun', flag: '🇨🇭', bcp47: 'rm' },
  { code: 'rn', name: 'Kirundi', nativeName: 'Ikirundi', flag: '🇧🇮', bcp47: 'rn' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴', bcp47: 'ro-RO' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', bcp47: 'ru-RU' },
  { code: 'rw', name: 'Kinyarwanda', nativeName: 'Ikinyarwanda', flag: '🇷🇼', bcp47: 'rw' },
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्', flag: '🇮🇳', bcp47: 'sa' },
  { code: 'sc', name: 'Sardinian', nativeName: 'sardu', flag: '🇮🇹', bcp47: 'sc' },
  { code: 'sd', name: 'Sindhi', nativeName: 'سنڌي', rtl: true, flag: '🇵🇰', bcp47: 'sd' },
  { code: 'se', name: 'Northern Sami', nativeName: 'Davvisámegiella', flag: '🇳🇴', bcp47: 'se' },
  { code: 'sg', name: 'Sango', nativeName: 'yângâ tî sängö', flag: '🇨🇫', bcp47: 'sg' },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', flag: '🇱🇰', bcp47: 'si-LK' },
  { code: 'sk', name: 'Slovak', nativeName: 'slovenčina', flag: '🇸🇰', bcp47: 'sk-SK' },
  { code: 'sl', name: 'Slovenian', nativeName: 'slovenščina', flag: '🇸🇮', bcp47: 'sl-SI' },
  { code: 'sm', name: 'Samoan', nativeName: "gagana fa'a Samoa", flag: '🇼🇸', bcp47: 'sm' },
  { code: 'sn', name: 'Shona', nativeName: 'chiShona', flag: '🇿🇼', bcp47: 'sn' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaaliga', flag: '🇸🇴', bcp47: 'so-SO' },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', flag: '🇦🇱', bcp47: 'sq-AL' },
  { code: 'sr', name: 'Serbian', nativeName: 'српски', flag: '🇷🇸', bcp47: 'sr-RS' },
  { code: 'ss', name: 'Swati', nativeName: 'SiSwati', flag: '🇸🇿', bcp47: 'ss' },
  { code: 'st', name: 'Southern Sotho', nativeName: 'Sesotho', flag: '🇱🇸', bcp47: 'st' },
  { code: 'su', name: 'Sundanese', nativeName: 'Basa Sunda', flag: '🇮🇩', bcp47: 'su-ID' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪', bcp47: 'sv-SE' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪', bcp47: 'sw-KE' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳', bcp47: 'ta-IN' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳', bcp47: 'te-IN' },
  { code: 'tg', name: 'Tajik', nativeName: 'тоҷикӣ', flag: '🇹🇯', bcp47: 'tg' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭', bcp47: 'th-TH' },
  { code: 'ti', name: 'Tigrinya', nativeName: 'ትግርኛ', flag: '🇪🇷', bcp47: 'ti' },
  { code: 'tk', name: 'Turkmen', nativeName: 'Türkmen', flag: '🇹🇲', bcp47: 'tk' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Wikang Tagalog', flag: '🇵🇭', bcp47: 'tl-PH' },
  { code: 'tn', name: 'Tswana', nativeName: 'Setswana', flag: '🇧🇼', bcp47: 'tn' },
  { code: 'to', name: 'Tonga', nativeName: 'faka Tonga', flag: '🇹🇴', bcp47: 'to' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', bcp47: 'tr-TR' },
  { code: 'ts', name: 'Tsonga', nativeName: 'Xitsonga', flag: '🇿🇦', bcp47: 'ts' },
  { code: 'tt', name: 'Tatar', nativeName: 'татар теле', flag: '🏳️', bcp47: 'tt' },
  { code: 'tw', name: 'Twi', nativeName: 'Twi', flag: '🇬🇭', bcp47: 'ak-GH' },
  { code: 'ty', name: 'Tahitian', nativeName: 'Reo Tahiti', flag: '🇵🇫', bcp47: 'ty' },
  { code: 'ug', name: 'Uyghur', nativeName: 'ئۇيغۇرچە', rtl: true, flag: '🇨🇳', bcp47: 'ug' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦', bcp47: 'uk-UA' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', rtl: true, flag: '🇵🇰', bcp47: 'ur-PK' },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbek', flag: '🇺🇿', bcp47: 'uz-UZ' },
  { code: 've', name: 'Venda', nativeName: 'Tshivenḓa', flag: '🇿🇦', bcp47: 've' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳', bcp47: 'vi-VN' },
  { code: 'vo', name: 'Volapük', nativeName: 'Volapük', flag: '🏳️', bcp47: 'vo' },
  { code: 'wa', name: 'Walloon', nativeName: 'walon', flag: '🇧🇪', bcp47: 'wa' },
  { code: 'wo', name: 'Wolof', nativeName: 'Wollof', flag: '🇸🇳', bcp47: 'wo' },
  { code: 'xh', name: 'Xhosa', nativeName: 'isiXhosa', flag: '🇿🇦', bcp47: 'xh-ZA' },
  { code: 'yi', name: 'Yiddish', nativeName: 'ייִדיש', rtl: true, flag: '🏳️', bcp47: 'yi' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', flag: '🇳🇬', bcp47: 'yo-NG' },
  { code: 'za', name: 'Zhuang', nativeName: 'Saɯ cueŋƅ', flag: '🇨🇳', bcp47: 'za' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳', bcp47: 'zh-CN' },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu', flag: '🇿🇦', bcp47: 'zu-ZA' },
  // ── ISO-639-3 extras (languages without 2-letter codes) ──
  { code: 'ceb', name: 'Cebuano', nativeName: 'Binisaya', flag: '🇵🇭', bcp47: 'ceb' },
  { code: 'haw', name: 'Hawaiian', nativeName: 'ʻŌlelo Hawaiʻi', flag: '🇺🇸', bcp47: 'haw' },
  { code: 'hmn', name: 'Hmong', nativeName: 'Hmoob', flag: '🇱🇦', bcp47: 'hmn' },
  { code: 'ilo', name: 'Ilocano', nativeName: 'Iloko', flag: '🇵🇭', bcp47: 'ilo' },
  { code: 'kri', name: 'Krio', nativeName: 'Krio', flag: '🇸🇱', bcp47: 'kri' },
  { code: 'mai', name: 'Maithili', nativeName: 'मैथिली', flag: '🇮🇳', bcp47: 'mai' },
  { code: 'mni', name: 'Meitei', nativeName: 'ꯃꯩꯇꯩꯂꯣꯟ', flag: '🇮🇳', bcp47: 'mni' },
  { code: 'nso', name: 'Northern Sotho', nativeName: 'Sesotho sa Leboa', flag: '🇿🇦', bcp47: 'nso' },
  { code: 'pcm', name: 'Nigerian Pidgin', nativeName: 'Naijá', flag: '🇳🇬', bcp47: 'pcm' },
  { code: 'tpi', name: 'Tok Pisin', nativeName: 'Tok Pisin', flag: '🇵🇬', bcp47: 'tpi' },
];

// ── Lookup maps (built once, used everywhere) ──────────────
const _byCode = new Map<string, Language>();
LANGUAGE_DATA.forEach((l) => _byCode.set(l.code, l));

/** All languages, sorted alphabetically by English name */
export const ALL_LANGUAGES: Language[] = [...LANGUAGE_DATA].sort((a, b) =>
  a.name.localeCompare(b.name),
);

/** Quick lookup: code → Language object */
export function getLanguage(code: string): Language | undefined {
  return _byCode.get(code);
}

/** code → English name (returns code itself if unknown) */
export function getLanguageName(code: string): string {
  return _byCode.get(code)?.name ?? code;
}

/** code → native name */
export function getLanguageNativeName(code: string): string {
  return _byCode.get(code)?.nativeName ?? code;
}

/** code → emoji flag */
export function getLanguageFlag(code: string): string {
  return _byCode.get(code)?.flag ?? '🌐';
}

/** code → BCP-47 tag for Speech APIs */
export function getBcp47(code: string): string {
  return _byCode.get(code)?.bcp47 ?? code;
}

/** code → whether script is RTL */
export function isRtl(code: string): boolean {
  return _byCode.get(code)?.rtl === true;
}

/** Returns all ISO codes as a flat array */
export function getAllCodes(): string[] {
  return LANGUAGE_DATA.map((l) => l.code);
}

/** Flat maps used for backward compat with old LANGUAGES / LANG_FLAGS / SPEECH_CODES */
export const LANGUAGES: Record<string, string> = Object.fromEntries(
  LANGUAGE_DATA.map((l) => [l.code, l.name]),
);

export const LANG_FLAGS: Record<string, string> = Object.fromEntries(
  LANGUAGE_DATA.map((l) => [l.code, l.flag ?? '🌐']),
);

export const SPEECH_CODES: Record<string, string> = Object.fromEntries(
  LANGUAGE_DATA.map((l) => [l.code, l.bcp47 ?? l.code]),
);

// ── TTS Support Map ────────────────────────────────────────
// Languages that have reliable browser / expo TTS voice support.
// If a language is NOT in this set, translation is text-only (no voice).
// Based on Web Speech API + expo-speech coverage across platforms.
export const TTS_SUPPORTED: Set<string> = new Set([
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da',
  'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl',
  'gu', 'ha', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja',
  'jv', 'ka', 'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'lo', 'lt', 'lv', 'mg',
  'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'nb', 'ne', 'nl', 'nn',
  'no', 'ny', 'or', 'pa', 'pl', 'ps', 'pt', 'qu', 'ro', 'ru', 'rw', 'sd',
  'si', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'st', 'su', 'sv', 'sw', 'ta',
  'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tr', 'tt', 'uk', 'ur', 'uz', 'vi',
  'wo', 'xh', 'yo', 'zh', 'zu',
]);

/** Check whether TTS is available for a language */
export function isTtsSupported(code: string): boolean {
  return TTS_SUPPORTED.has(code);
}

// ── Per-User Language Preference ───────────────────────────
export interface UserLanguagePreference {
  userId: string;
  preferredLanguage: string;
  receiveVoice: boolean;   // If true AND TTS is available → generate voice
  receiveText: boolean;    // Always true; kept for future opt-out
}
