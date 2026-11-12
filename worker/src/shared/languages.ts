export interface Language {
  code: string;
  flag: string;
  en: string;
  ar: string;
}

/** Target languages offered to users. Every code must exist in the backend's translation brick. */
export const LANGUAGES: Language[] = [
  { code: 'ar', flag: '🇸🇦', en: 'Arabic', ar: 'العربية' },
  { code: 'en', flag: '🇬🇧', en: 'English', ar: 'الإنجليزية' },
  { code: 'fr', flag: '🇫🇷', en: 'French', ar: 'الفرنسية' },
  { code: 'es', flag: '🇪🇸', en: 'Spanish', ar: 'الإسبانية' },
  { code: 'de', flag: '🇩🇪', en: 'German', ar: 'الألمانية' },
  { code: 'tr', flag: '🇹🇷', en: 'Turkish', ar: 'التركية' },
  { code: 'fa', flag: '🇮🇷', en: 'Persian', ar: 'الفارسية' },
  { code: 'ur', flag: '🇵🇰', en: 'Urdu', ar: 'الأردية' },
  { code: 'ru', flag: '🇷🇺', en: 'Russian', ar: 'الروسية' },
  { code: 'it', flag: '🇮🇹', en: 'Italian', ar: 'الإيطالية' },
  { code: 'pt', flag: '🇵🇹', en: 'Portuguese', ar: 'البرتغالية' },
  { code: 'id', flag: '🇮🇩', en: 'Indonesian', ar: 'الإندونيسية' },
  { code: 'hi', flag: '🇮🇳', en: 'Hindi', ar: 'الهندية' },
  { code: 'zh', flag: '🇨🇳', en: 'Chinese', ar: 'الصينية' },
  { code: 'ja', flag: '🇯🇵', en: 'Japanese', ar: 'اليابانية' },
];

export const isTargetLang = (code: string) => LANGUAGES.some((l) => l.code === code);
