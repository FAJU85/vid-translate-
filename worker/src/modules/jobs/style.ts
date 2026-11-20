/**
 * How burned-in subtitles look. The Space validates it again (subtitles.SubtitleStyle) and
 * falls back to the default for anything it does not recognise.
 */
export interface SubtitleStyle {
  size: 'small' | 'medium' | 'large' | 'xlarge';
  position: 'bottom' | 'middle' | 'top';
  color: string; // #RRGGBB
  background: 'outline' | 'box';
  /** modern: Noto Sans (Arabic); classic: Noto Serif / Naskh; bold: Noto Sans Bold / Kufi. */
  font: 'modern' | 'classic' | 'bold';
  /** Also show the original text, smaller, next to the translation. */
  bilingual: boolean;
  /** Dubbing: the voice that speaks the translation. */
  voice: 'female' | 'male';
}

export const SUBTITLE_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export const SUBTITLE_POSITIONS = ['bottom', 'middle', 'top'] as const;
export const SUBTITLE_BACKGROUNDS = ['outline', 'box'] as const;
export const SUBTITLE_FONTS = ['modern', 'classic', 'bold'] as const;
export const DEFAULT_STYLE: SubtitleStyle = { size: 'medium', position: 'bottom', color: '#FFFFFF', background: 'outline', font: 'modern', bilingual: false, voice: 'female' };

/** Ready-made designs: one tap sets every field. */
export const STYLE_PRESETS: Record<'cinema' | 'boldbox' | 'elegant' | 'social', SubtitleStyle> = {
  cinema: DEFAULT_STYLE,
  boldbox: { size: 'large', position: 'bottom', color: '#FFD400', background: 'box', font: 'bold', bilingual: false, voice: 'female' },
  elegant: { size: 'medium', position: 'bottom', color: '#FFFFFF', background: 'outline', font: 'classic', bilingual: false, voice: 'female' },
  social: { size: 'xlarge', position: 'middle', color: '#FFFFFF', background: 'box', font: 'bold', bilingual: false, voice: 'female' },
};

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Validate user input; unknown or malformed values keep the default. */
export function parseSubtitleStyle(input: unknown): SubtitleStyle {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toUpperCase() : DEFAULT_STYLE.color;
  return {
    size: pick(SUBTITLE_SIZES, raw.size, DEFAULT_STYLE.size),
    position: pick(SUBTITLE_POSITIONS, raw.position, DEFAULT_STYLE.position),
    color,
    background: pick(SUBTITLE_BACKGROUNDS, raw.background, DEFAULT_STYLE.background),
    font: pick(SUBTITLE_FONTS, raw.font, DEFAULT_STYLE.font),
    bilingual: raw.bilingual === true,
    voice: raw.voice === 'male' ? 'male' : 'female',
  };
}

/** Target languages with no Microsoft Edge voice: subtitles only. */
export const NO_DUB_LANGS = ['ku', 'ha'];
export const canDub = (lang: string) => !NO_DUB_LANGS.includes(lang);
