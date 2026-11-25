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
    lines: oneOf(['translation', 'original'] as const, saved.lines, 'translation'),
    look: oneOf(LOOKS.map(([id]) => id), saved.look, 'wave'),
    backdrop: oneOf(BACKDROPS.map(([id]) => id), saved.backdrop, 'kavox'),
    frame: oneOf(FRAMES.map(([id]) => id), saved.frame, 'vertical'),
    title_card: saved.title_card !== false,
    bar: saved.bar !== false,
  };
}

export function remember(style: SubtitleStyle): void {
  try {
    // A song's title and artist belong to that song: never carried over to the next one.
    const { title: _title, artist: _artist, ...kept } = style;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
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
const LINES: [NonNullable<SubtitleStyle['lines']>, string][] = [
  ['translation', t("The translation")],
  ['original', t("The original words")],
];
// Sound alone made into a video (backend media/visual.py): the same choices and colours.
const LOOKS: [NonNullable<SubtitleStyle['look']>, string][] = [
  ['wave', t("Wave")],
  ['neon', t("Neon")],
  ['bars', t("Bars")],
];
const BACKDROPS: [NonNullable<SubtitleStyle['backdrop']>, string, string][] = [
  ['kavox', t("KAVOX"), 'linear-gradient(#131C31, #0F5E68)'],
  ['night', t("Night"), 'linear-gradient(#05060A, #2A1B5C)'],
  ['sunset', t("Sunset"), 'linear-gradient(#4A1030, #C2410C)'],
  ['forest', t("Forest"), 'linear-gradient(#06281E, #3F6212)'],
  ['cover', t("Cover art"), 'linear-gradient(135deg, #334155, #64748B)'],
];
const FRAMES: [NonNullable<SubtitleStyle['frame']>, string, string][] = [
  ['vertical', t("Vertical 9:16"), '9 / 16'],
  ['square', t("Square 1:1"), '1 / 1'],
  ['wide', t("Wide 16:9"), '16 / 9'],
];
const field = 'w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400';
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
// `height`: the picture's height in percent of its width (56.25 for 16:9; a vertical one is taller).
const cqw = (size: number, em = 1, height = 56.25) => `${((size / 288) * height * 0.729 * em).toFixed(2)}cqw`;
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

/** A stand-in for the moving picture drawn from the sound (the real one follows the music). */
function Visualizer({ look, tick }: { look: NonNullable<SubtitleStyle['look']>; tick: number }) {
  const bars = Array.from({ length: 24 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.9 + tick * 0.7) * Math.cos(i * 0.35 - tick * 0.4)));
  const colour = look === 'neon' ? '#2DD4BF' : '#FFFFFF';
  return (
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[24%] flex items-center justify-center gap-[1.2%] px-[2%]" aria-hidden>
      {bars.map((v, i) =>
        look === 'bars' ? (
          <span key={i} className="flex-1 self-end rounded-t-sm transition-all duration-300" style={{ height: `${v * 100}%`, background: `hsl(${40 + i * 7} 95% 60%)` }} />
        ) : (
          <span
            key={i}
            className="flex-1 rounded-full transition-all duration-300"
            style={{ height: `${v * 100}%`, background: colour, boxShadow: look === 'neon' ? `0 0 8px ${colour}` : 'none' }}
          />
        ),
      )}
    </div>
  );
}

/**
 * Size, position, colour and background of burned-in subtitles, with a live preview. `sound`: the
 * chosen file is sound alone (a song, a podcast), so the video is made from it: its look comes first
 * and the preview takes its shape and background. For a link it may be either: the choices are folded.
 */
export function StylePicker({ style, onChange, lang, sound = false }: { style: SubtitleStyle; onChange: (s: SubtitleStyle) => void; lang: string; sound?: boolean }) {
  const update = (patch: Partial<SubtitleStyle>) => {
    const next = { ...style, ...patch };
    remember(next);
    onChange(next);
  };
  const apply = (preset: SubtitleStyle) => {
    // A design changes the text's look only: what is shown and the picture for sound alone stay.
    const { bilingual, voice, lines, look, backdrop, frame } = style;
    const next = { ...preset, bilingual, voice, lines, look, backdrop, frame };
    remember(next);
    onChange(next);
  };
  const lines = style.lines ?? 'translation';
  // The main line's language: the original is not known yet (shown in English, or Arabic for English).
  const rtl = lines === 'original' ? lang === 'en' : RTL.has(lang);
  const frameShape = FRAMES.find(([id]) => id === (style.frame ?? 'vertical'))![2];
  const [fw, fh] = frameShape.split(' / ').map(Number);
  const height = sound ? (fh / fw) * 100 : 56.25;
  const backdropFill = BACKDROPS.find(([id]) => id === (style.backdrop ?? 'kavox'))![2];
  const sample = rtl ? 'هذه معاينة لشكل الكلمات على الفيديو' : 'This is how the words will look';
  // Dynamic captions: step through the sample's words like a speaker would.
  const animation = style.animation ?? 'none';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (animation === 'none' && !sound) return;
    const timer = setInterval(() => setTick((t) => t + 1), 420);
    return () => clearInterval(timer);
  }, [animation, sound]);
  const sampleWords = sample.split(' ');
  const lit = tick % sampleWords.length;
  const litColour = style.color.toUpperCase() === '#FFFFFF' ? '#FFD400' : style.color;
  // Pop-up words: the group of up to three words the spoken one is in (backend ass.py _pop_chunks).
  const group = Math.floor(lit / 3);
  const shown = animation === 'pop' ? sampleWords.slice(group * 3, group * 3 + 3) : sampleWords;
  const shownLit = animation === 'pop' ? lit - group * 3 : lit;
  // The original language is not known yet: show English, or Arabic when translating into English.
  const originalSample = lines === 'original' ? (RTL.has(lang) ? 'هذه هي الترجمة' : 'This is the translation') : lang === 'en' ? 'هذا هو النص الأصلي' : 'This is the original text';
  const originalRtl = lines === 'original' ? RTL.has(lang) : lang === 'en';
  const box = style.background === 'box';
  const placement =
    style.position === 'top' ? { top: '7.6%' } : style.position === 'middle' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: '7.6%' };

  const soundChoices = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <div className="text-xs text-slate-400 mb-1.5">{t("Look")}</div>
        <Segmented value={style.look ?? 'wave'} options={LOOKS} onChange={(look) => update({ look })} />
      </div>
      <div>
        <div className="text-xs text-slate-400 mb-1.5">{t("Shape")}</div>
        <Segmented value={style.frame ?? 'vertical'} options={FRAMES.map(([id, label]) => [id, label])} onChange={(frame) => update({ frame })} />
      </div>
      <div className="sm:col-span-2">
        <div className="text-xs text-slate-400 mb-1.5">{t("Colours")}</div>
        <div className="flex flex-wrap gap-2">
          {BACKDROPS.map(([id, label, fill]) => (
            <button
              key={id}
              type="button"
              onClick={() => update({ backdrop: id })}
              aria-pressed={(style.backdrop ?? 'kavox') === id}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm ${
                (style.backdrop ?? 'kavox') === id ? 'border-amber-400 bg-amber-400/10 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="w-5 h-5 rounded" style={{ background: fill }} /> {label}
            </button>
          ))}
        </div>
        {(style.backdrop ?? 'kavox') === 'cover' && (
          <p className="mt-1 text-xs text-slate-500">{t("The picture inside your audio file (its album art), blurred. A file without one gets the KAVOX colours.")}</p>
        )}
      </div>
      <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer select-none">
        <input type="checkbox" checked={style.title_card !== false} onChange={(e) => update({ title_card: e.target.checked })} className="w-4 h-4 accent-amber-400" />
        {t("Title and artist at the top")}
      </label>
      <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer select-none">
        <input type="checkbox" checked={style.bar !== false} onChange={(e) => update({ bar: e.target.checked })} className="w-4 h-4 accent-amber-400" />
        {t("A bar that fills as it plays")}
      </label>
      {style.title_card !== false && (
        <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
          <input
            value={style.title ?? ''}
            maxLength={80}
            onChange={(e) => update({ title: e.target.value })}
            placeholder={t("Title (from the song itself if empty)")}
            className={field}
          />
          <input
            value={style.artist ?? ''}
            maxLength={80}
            onChange={(e) => update({ artist: e.target.value })}
            placeholder={t("Artist (from the song itself if empty)")}
            className={field}
          />
        </div>
      )}
    </div>
  );

  return (    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-4">
      <div className="text-sm font-medium text-slate-200">{sound ? t("Your lyrics video") : t("Subtitle style")}</div>
      {sound && (
        <>
          <p className="text-xs text-slate-400">{t("Your file is sound only, so KAVOX makes the picture: a background, the sound drawn as it plays, and the words lit as they are sung or spoken.")}</p>
          {soundChoices}
        </>
      )}

      <div
        className={`relative rounded-lg overflow-hidden ${sound ? 'mx-auto' : 'w-full aspect-video bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900'}`}
        style={{
          containerType: 'inline-size',
          ...(sound ? { aspectRatio: frameShape, width: style.frame === 'vertical' ? 'min(100%, 15rem)' : style.frame === 'square' ? 'min(100%, 24rem)' : '100%', background: backdropFill } : {}),
        }}
        aria-label={t("Subtitle preview")}
      >
        {sound && <Visualizer look={style.look ?? 'wave'} tick={tick} />}
        {sound && style.title_card !== false && (
          <div className="absolute inset-x-0 top-[3%] px-[4%] text-center leading-tight" style={{ fontSize: cqw(16, 1, height), textShadow: '0 0 2px #000, 0 0 3px #000' }}>
            <div className="font-bold text-white truncate">{style.title || t("Song title")}</div>
            <div className="text-slate-300 truncate" style={{ fontSize: '0.75em' }}>{style.artist || t("Artist")}</div>
          </div>
        )}
        {sound && style.bar !== false && (
          <div className="absolute bottom-0 left-0 h-[0.6%] min-h-[3px] bg-amber-400 transition-all duration-300" style={{ width: `${((tick % 40) / 40) * 100}%` }} />
        )}
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
              fontSize: cqw(FONT_SIZE[style.size], rtl ? FONT_FAMILY[style.font].em : 1, height),
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
                fontSize: cqw(FONT_SIZE[style.size] * 0.72, originalRtl ? FONT_FAMILY[style.font].em : 1, height),
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
        <div className="sm:col-span-2">
          <div className="text-xs text-slate-400 mb-1.5">{t("Main text")}</div>
          <Segmented value={lines} options={LINES} onChange={(l) => update({ lines: l })} />
          <p className="mt-1 text-xs text-slate-500">
            {lines === 'original' ? t("The words as they are said or sung, like karaoke. Tick the box below to add the translation under them.") : t("The words in the language you chose.")}
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer select-none sm:col-span-2">
          <input
            type="checkbox"
            checked={Boolean(style.bilingual)}
            onChange={(e) => update({ bilingual: e.target.checked })}
            className="w-4 h-4 accent-amber-400"
          />
          {lines === 'original' ? t("Show the translation too, in smaller letters") : t("Show the original text too, in smaller letters")}
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
      {!sound && (
        <details className="rounded-lg border border-slate-800 p-3">
          <summary className="text-sm text-slate-300 cursor-pointer">{t("If it is a song or audio only: its picture")}</summary>
          <p className="mt-2 mb-3 text-xs text-slate-400">{t("A link or file with sound only becomes a video: a background, the sound drawn as it plays, and the words.")}</p>
          {soundChoices}
        </details>
      )}
    </div>
  );
}
