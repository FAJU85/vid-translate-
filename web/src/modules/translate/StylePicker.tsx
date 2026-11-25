import { useEffect, useState } from 'react';
import type { SubtitleStyle } from '../../shared/api';
import { t } from '../../shared/i18n';

export const DEFAULT_STYLE: SubtitleStyle = { size: 'medium', position: 'bottom', color: '#FFFFFF', background: 'outline', font: 'modern', animation: 'none' };

/** Ready-made designs (the same four as the Telegram bot's /style). */
const PRESETS: [string, string, string, SubtitleStyle][] = [
  ['cinema', '🎬', 'Cinema', DEFAULT_STYLE],
  ['boldbox', '🟨', 'Bold box', { size: 'large', position: 'bottom', color: '#FFD400', background: 'box', font: 'bold', animation: 'none' }],
  ['elegant', '✒️', 'Elegant', { size: 'medium', position: 'bottom', color: '#FFFFFF', background: 'outline', font: 'classic', animation: 'none' }],
  ['social', '📱', 'Social', { size: 'xlarge', position: 'middle', color: '#FFFFFF', background: 'box', font: 'bold', animation: 'pop' }],
];

const STORAGE_KEY = 'tarjim_subtitle_style';

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** The style used last time in this browser, or the default; anything unreadable keeps its default. */
export function rememberedStyle(): SubtitleStyle {
  let saved: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {
    /* blocked or corrupted: use the default */
  }
  return {
    size: oneOf(['small', 'medium', 'large', 'xlarge'], saved.size, DEFAULT_STYLE.size),
    position: oneOf(['bottom', 'middle', 'top'], saved.position, DEFAULT_STYLE.position),
    color: typeof saved.color === 'string' && /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color.toUpperCase() : DEFAULT_STYLE.color,
    background: oneOf(['outline', 'box'], saved.background, DEFAULT_STYLE.background),
    font: oneOf(['modern', 'classic', 'bold'], saved.font, DEFAULT_STYLE.font),
    bilingual: saved.bilingual === true,
    voice: saved.voice === 'male' || saved.voice === 'classic' ? saved.voice : 'female',
    animation: oneOf(['none', 'highlight', 'pop'] as const, saved.animation, 'none'),
  };
}

export function remember(style: SubtitleStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {
    /* storage blocked: the choice still applies to this video */
  }
}

const SIZES: [SubtitleStyle['size'], string][] = [
  ['small', t("Small")],
  ['medium', t("Medium")],
  ['large', t("Large")],
  ['xlarge', t("Extra large")],
];
const POSITIONS: [SubtitleStyle['position'], string][] = [
  ['bottom', t("Bottom")],
  ['middle', t("Middle")],
  ['top', t("Top")],
];
const BACKGROUNDS: [SubtitleStyle['background'], string][] = [
  ['outline', t("Outline")],
  ['box', t("Dark box")],
];
const FONTS: [SubtitleStyle['font'], string][] = [
  ['modern', t("Modern")],
  ['classic', t("Classic")],
  ['bold', t("Bold")],
];
const ANIMATIONS: [NonNullable<SubtitleStyle['animation']>, string][] = [
  ['none', t("Static")],
  ['highlight', t("Word highlight")],
  ['pop', t("Pop-up words")],
];
const COLORS = ['#FFFFFF', '#FFD400', '#38BDF8', '#4ADE80', '#FB923C', '#F472B6'];

// The fonts the server burns in, per writing system (backend subtitles/ass.py FONTS). `em` is how
// much larger than Noto Sans the server draws that Arabic font: its size scale x 1.362 / its line height.
const FONT_FAMILY: Record<SubtitleStyle['font'], { latin: string; arabic: string; weight: number; em: number }> = {
  modern: { latin: "'Noto Sans', sans-serif", arabic: "'Noto Sans Arabic', sans-serif", weight: 400, em: 1 },
  classic: { latin: "'Noto Serif', serif", arabic: "'Noto Naskh Arabic', serif", weight: 400, em: 1.16 },
  bold: { latin: "'Noto Sans', sans-serif", arabic: "'Noto Kufi Arabic', sans-serif", weight: 700, em: 0.97 },
};

// Ready-made designs leave "show the original too" as it is.
const same = (a: SubtitleStyle, b: SubtitleStyle) =>
  (['size', 'position', 'color', 'background', 'font'] as const).every((k) => a[k] === b[k]) && (a.animation ?? 'none') === (b.animation ?? 'none');

// The renderer sizes text against a 288-pixel-high frame (18 = medium), by line height: letters
// come out at 72.9% of that (Arabic and serif fonts are scaled on the server to match). In a 16:9 preview the
// height is 56.25% of the width, so a size of N is drawn at N / 288 * 56.25 * 0.729 percent of it.
const FONT_SIZE = { small: 14, medium: 18, large: 24, xlarge: 30 };
const cqw = (size: number, em = 1) => `${((size / 288) * 56.25 * 0.729 * em).toFixed(2)}cqw`;
const RTL = new Set(['ar', 'fa', 'ur', 'he', 'ps']);

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap p-1 rounded-xl bg-slate-950 border border-slate-800 text-sm">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`px-3 py-1.5 rounded-lg ${value === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Size, position, colour and background of burned-in subtitles, with a live preview. */
export function StylePicker({ style, onChange, lang }: { style: SubtitleStyle; onChange: (s: SubtitleStyle) => void; lang: string }) {
  const update = (patch: Partial<SubtitleStyle>) => {
    const next = { ...style, ...patch };
    remember(next);
    onChange(next);
  };
  const apply = (preset: SubtitleStyle) => {
    const next = { ...preset, bilingual: style.bilingual, voice: style.voice };
    remember(next);
    onChange(next);
  };
  const rtl = RTL.has(lang);
  const sample = rtl ? 'هذه معاينة لشكل الترجمة على الفيديو' : 'This is how your subtitles will look';
  // Dynamic captions: step through the sample's words like a speaker would.
  const animation = style.animation ?? 'none';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (animation === 'none') return;
    const timer = setInterval(() => setTick((t) => t + 1), 420);
    return () => clearInterval(timer);
  }, [animation]);
  const sampleWords = sample.split(' ');
  const lit = tick % sampleWords.length;
  const litColour = style.color.toUpperCase() === '#FFFFFF' ? '#FFD400' : style.color;
  // Pop-up words: the group of up to three words the spoken one is in (backend ass.py _pop_chunks).
  const group = Math.floor(lit / 3);
  const shown = animation === 'pop' ? sampleWords.slice(group * 3, group * 3 + 3) : sampleWords;
  const shownLit = animation === 'pop' ? lit - group * 3 : lit;
  // The original language is not known yet: show English, or Arabic when translating into English.
  const originalSample = lang === 'en' ? 'هذا هو النص الأصلي' : 'This is the original text';
  const originalRtl = lang === 'en';
  const box = style.background === 'box';
  const placement =
    style.position === 'top' ? { top: '7.6%' } : style.position === 'middle' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: '7.6%' };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-4">
      <div className="text-sm font-medium text-slate-200">{t("Subtitle style")}</div>

      <div
        className="relative w-full aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900"
        style={{ containerType: 'inline-size' }}
        aria-label={t("Subtitle preview")}
      >
        <div
          className={`absolute inset-x-0 flex items-center gap-[0.6cqw] px-[4%] ${style.position === 'top' ? 'flex-col' : 'flex-col-reverse'}`}
          style={placement}
        >
          {/* As on the video: the translation nearest the edge, the original beside it, smaller. */}
          <span
            dir={rtl ? 'rtl' : 'ltr'}
            className="text-center leading-snug"
            style={{
              color: style.color,
              fontSize: cqw(FONT_SIZE[style.size], rtl ? FONT_FAMILY[style.font].em : 1),
              fontFamily: rtl ? FONT_FAMILY[style.font].arabic : FONT_FAMILY[style.font].latin,
              fontWeight: FONT_FAMILY[style.font].weight,
              background: box ? 'rgba(0,0,0,0.62)' : 'transparent',
              padding: box ? '0.15em 0.4em' : 0,
              borderRadius: box ? '0.15em' : 0,
              textShadow: box ? 'none' : '0 0 2px #000, 0 0 2px #000, 0 0 3px #000',
            }}
          >
            {animation === 'none' ? (
              sample
            ) : (
              // A new pop-up group grows in, like on the video.
              <span key={animation === 'pop' ? group : 'line'} className={animation === 'pop' ? 'inline-block animate-[caption-pop_120ms_ease-out]' : undefined}>
                {shown.map((w, i) => (
                  <span key={i} style={{ color: i === shownLit ? litColour : '#FFFFFF' }}>
                    {w}
                    {i < shown.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </span>
            )}
          </span>
          {style.bilingual && (
            <span
              dir={originalRtl ? 'rtl' : 'ltr'}
              className="text-center leading-snug"
              style={{
                color: '#E2E8F0',
                fontSize: cqw(FONT_SIZE[style.size] * 0.72, originalRtl ? FONT_FAMILY[style.font].em : 1),
                fontFamily: originalRtl ? FONT_FAMILY[style.font].arabic : FONT_FAMILY[style.font].latin,
                background: box ? 'rgba(0,0,0,0.62)' : 'transparent',
                padding: box ? '0.15em 0.4em' : 0,
                borderRadius: box ? '0.15em' : 0,
                textShadow: box ? 'none' : '0 0 2px #000, 0 0 2px #000, 0 0 3px #000',
              }}
            >
              {originalSample}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1.5">{t("Ready-made designs")}</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(([id, icon, label, preset]) => (
            <button
              key={id}
              type="button"
              onClick={() => apply(preset)}
              aria-pressed={same(style, preset)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${
                same(style, preset) ? 'border-amber-400 bg-amber-400/10 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {icon} {t(label)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-400 mb-1.5">{t("Font")}</div>
          <Segmented value={style.font} options={FONTS} onChange={(font) => update({ font })} />
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1.5">{t("Size")}</div>
          <Segmented value={style.size} options={SIZES} onChange={(size) => update({ size })} />
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1.5">{t("Position")}</div>
          <Segmented value={style.position} options={POSITIONS} onChange={(position) => update({ position })} />
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1.5">{t("Background")}</div>
          <Segmented value={style.background} options={BACKGROUNDS} onChange={(background) => update({ background })} />
        </div>
        <div className="sm:col-span-2">
          <div className="text-xs text-slate-400 mb-1.5">{t("Words")}</div>
          <Segmented value={animation} options={ANIMATIONS} onChange={(a) => update({ animation: a })} />
          <p className="mt-1 text-xs text-slate-500">
            {animation === 'highlight'
              ? t("Each word lights up as it is spoken.")
              : animation === 'pop'
                ? t("A few words at a time, popping in as they are spoken: the short-video look.")
                : t("The whole line appears at once.")}
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer select-none sm:col-span-2">
          <input
            type="checkbox"
            checked={Boolean(style.bilingual)}
            onChange={(e) => update({ bilingual: e.target.checked })}
            className="w-4 h-4 accent-amber-400"
          />
          {t("Show the original text too, in smaller letters")}
        </label>
        <div>
          <div className="text-xs text-slate-400 mb-1.5">{t("Text colour")}</div>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => update({ color: c })}
                aria-label={`Colour ${c}`}
                aria-pressed={style.color.toUpperCase() === c}
                className={`w-8 h-8 rounded-full border-2 ${style.color.toUpperCase() === c ? 'border-amber-400' : 'border-slate-700'}`}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={style.color}
              onChange={(e) => update({ color: e.target.value.toUpperCase() })}
              aria-label={t("Custom colour")}
              className="w-10 h-8 rounded-lg border border-slate-700 bg-slate-950 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
