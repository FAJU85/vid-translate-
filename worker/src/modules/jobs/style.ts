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
  /** Dubbing: the voice that speaks the translation (classic: eSpeak NG, rule-based, no AI). */
  voice: 'female' | 'male' | 'classic';
  /** Dynamic captions: none, highlight (the spoken word lights up), pop (a few words at a time). */
  animation: 'none' | 'highlight' | 'pop';
  /** The main line: the translation, or the original words (a song's own lyrics); bilingual adds the other. */
  lines: 'translation' | 'original';
  /** Sound alone (a song, a podcast) made into a video: the visualizer, the background, the shape. */
  look: 'wave' | 'neon' | 'bars';
  backdrop: 'kavox' | 'night' | 'sunset' | 'forest' | 'cover';
  frame: 'vertical' | 'square' | 'wide';
}

export const SUBTITLE_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export const SUBTITLE_POSITIONS = ['bottom', 'middle', 'top'] as const;
export const SUBTITLE_BACKGROUNDS = ['outline', 'box'] as const;
export const SUBTITLE_FONTS = ['modern', 'classic', 'bold'] as const;
export const SUBTITLE_ANIMATIONS = ['none', 'highlight', 'pop'] as const;
export const SUBTITLE_LINES = ['translation', 'original'] as const;
export const VISUAL_LOOKS = ['wave', 'neon', 'bars'] as const;
export const VISUAL_BACKDROPS = ['kavox', 'night', 'sunset', 'forest', 'cover'] as const;
export const VISUAL_FRAMES = ['vertical', 'square', 'wide'] as const;
/** The parts a ready-made design leaves as they are: what to show and, for sound alone, its picture. */
const KEEP = { lines: 'translation', look: 'wave', backdrop: 'kavox', frame: 'vertical' } as const;
export const DEFAULT_STYLE: SubtitleStyle = { size: 'medium', position: 'bottom', color: '#FFFFFF', background: 'outline', font: 'modern', bilingual: false, voice: 'female', animation: 'none', ...KEEP };

/** Ready-made designs: one tap sets every field. */
export const STYLE_PRESETS: Record<'cinema' | 'boldbox' | 'elegant' | 'social', SubtitleStyle> = {
  cinema: DEFAULT_STYLE,
  boldbox: { size: 'large', position: 'bottom', color: '#FFD400', background: 'box', font: 'bold', bilingual: false, voice: 'female', animation: 'none', ...KEEP },
  elegant: { size: 'medium', position: 'bottom', color: '#FFFFFF', background: 'outline', font: 'classic', bilingual: false, voice: 'female', animation: 'none', ...KEEP },
  social: { size: 'xlarge', position: 'middle', color: '#FFFFFF', background: 'box', font: 'bold', bilingual: false, voice: 'female', animation: 'pop', ...KEEP },
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
    voice: raw.voice === 'male' || raw.voice === 'classic' ? raw.voice : 'female',
    animation: pick(SUBTITLE_ANIMATIONS, raw.animation, DEFAULT_STYLE.animation),
    lines: pick(SUBTITLE_LINES, raw.lines, DEFAULT_STYLE.lines),
    look: pick(VISUAL_LOOKS, raw.look, DEFAULT_STYLE.look),
    backdrop: pick(VISUAL_BACKDROPS, raw.backdrop, DEFAULT_STYLE.backdrop),
    frame: pick(VISUAL_FRAMES, raw.frame, DEFAULT_STYLE.frame),
  };
}

/** Target languages with no voice at all: subtitles only. (Kurdish has no Microsoft Edge voice;
 * the Space speaks it with the classic eSpeak NG voice whatever voice was chosen.) */
export const NO_DUB_LANGS = ['ha'];
/** Target languages only the classic voice speaks. */
export const CLASSIC_ONLY_LANGS = ['ku'];
export const canDub = (lang: string) => !NO_DUB_LANGS.includes(lang);
