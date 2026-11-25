import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Link2, Loader2, Music, Palette, Share2, Upload, Wand2 } from 'lucide-react';
import { ApiError, api, type AppConfig, type Job, type Me, type SubtitleStyle } from '../../shared/api';
import { ConsentCheck, useConsent } from '../../shared/consent';
import { languageName, t } from '../../shared/i18n';
import { CostPreview, JobView, SOURCE_LANGS, StylePicker, readDuration, rememberedStyle, uploadFile } from '../translate';

const inputClass =
  'w-full px-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400';
const NO_TRANSLATION = 'none';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
        <span className="w-6 h-6 rounded-full bg-amber-400/15 text-amber-300 text-xs font-bold flex items-center justify-center">{n}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

interface Props {
  config: AppConfig | null;
  jobId: string | null;
  onJob: (id: string | null) => void;
  onCreditsChanged?: () => void;
  me?: Me | null;
  onPricing?: () => void;
  onSignIn?: () => void;
}

/**
 * Lyrics page: its own journey, apart from translating. A song, a podcast or any video becomes a
 * "faceless" lyrics video: a new picture (background, the sound drawn as it plays), the words lit
 * as they are sung, and, if wanted, a translation in its own caption. A video's picture is not used.
 */
export function LyricsView({ config, jobId, onJob, onCreditsChanged, me, onPricing, onSignIn }: Props) {
  const legalVersion = config?.legal_version ?? '';
  const [agreed, setAgreed] = useConsent(legalVersion);
  const [askConsent] = useState(() => !agreed);
  const [source, setSource] = useState<'upload' | 'url'>('upload');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [srcLang, setSrcLang] = useState('auto');
  const [translateTo, setTranslateTo] = useState<string>('ar');
  // Lyrics light up word by word from the start; the rest is the person's last choice.
  const [style, setStyle] = useState<SubtitleStyle>(() => {
    const saved = rememberedStyle();
    return { ...saved, animation: saved.animation === 'none' ? 'highlight' : saved.animation };
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const maxMb = config?.max_upload_mb ?? 500;

  // "No translation" and the translation's place "Off" are the same choice, kept in step.
  useEffect(() => {
    if (translateTo === NO_TRANSLATION && style.translation_at !== 'off') setStyle((s) => ({ ...s, translation_at: 'off' }));
    if (translateTo !== NO_TRANSLATION && style.translation_at === 'off') setStyle((s) => ({ ...s, translation_at: 'top' }));
  }, [translateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (style.translation_at === 'off' && translateTo !== NO_TRANSLATION) setTranslateTo(NO_TRANSLATION);
  }, [style.translation_at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFileDuration(null);
    if (!file || !me?.credits_enabled) return;
    let live = true;
    readDuration(file).then((d) => live && setFileDuration(d));
    return () => {
      live = false;
    };
  }, [file, me?.credits_enabled]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // The translation language when there is one; without, the Space skips translating.
    const tgt = translateTo === NO_TRANSLATION ? (config?.languages[0]?.code ?? 'ar') : translateTo;
    const options = { src_lang: srcLang, tgt_lang: tgt, subtitle_mode: 'hard' as const, consent: legalVersion, style: { ...style, visual: true } };
    try {
      let job: Job;
      if (source === 'url') {
        setBusy(t("Submitting…"));
        job = await api.create({ ...options, video_url: link.trim() });
      } else {
        if (!file) throw new ApiError('E_NO_FILE', t("Choose a song or a video first."));
        if (file.size > maxMb * 1024 * 1024) throw new ApiError('E_FILE_TOO_LARGE', t('The file is larger than {n} MB.', { n: maxMb }));
        setBusy(t("Preparing upload…"));
        const duration = await readDuration(file);
        job = await api.create({ ...options, duration, upload: { name: file.name, size: file.size, duration } });
        await uploadFile(
          job.upload_url!,
          file,
          (fraction) => setBusy(t('Uploading… {n}%', { n: Math.round(fraction * 100) })),
          () => setBusy(t("Waking up the translation server (can take a couple of minutes)…")),
        );
        job = await api.start(job.id, duration);
      }
      onJob(job.id);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong."));
    } finally {
      setBusy(null);
      onCreditsChanged?.();
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-100 max-w-3xl">{t("Make a lyrics video")}</h1>
        <p className="text-sm md:text-base text-slate-400 max-w-2xl">
          {t("Turn a song, a podcast or any video into a video with moving visuals and the words lit as they are sung. Add a translation in its own caption if you like. No face or camera needed.")}
        </p>
        <ol className="grid grid-cols-3 gap-2 text-sm">
          {(
            [
              [Music, t("Add a song"), t("Or any video: only its sound is used")],
              [Palette, t("Choose the look"), t("Visuals, colours, shape, lyrics")],
              [Share2, t("Share it"), t("Reels, TikTok, Shorts, or a link")],
            ] as const
          ).map(([Icon, title, body], i) => (
            <li key={title} className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border border-slate-800 bg-slate-900/60 text-center sm:text-start">
              <span className="w-9 h-9 shrink-0 rounded-xl bg-amber-400/15 text-amber-300 flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </span>
              <span>
                <span className="block text-xs sm:text-sm font-semibold text-slate-100">
                  {i + 1}. {title}
                </span>
                <span className="hidden sm:block text-xs text-slate-400">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <form onSubmit={submit} className="p-5 md:p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20 space-y-6">
        <Step n={1} title={t("Your song or video")}>
          <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 text-sm">
            {(
              [
                ['upload', t("Upload a file"), Upload],
                ['url', t("Link"), Link2],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSource(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${source === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
          {source === 'url' ? (
            <label className="block">
              <span className="block text-sm font-medium text-slate-200 mb-1.5">{t("Link to a song or a video")}</span>
              <input type="url" dir="ltr" required value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("https://…")} className={inputClass} />
            </label>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
              className={`block cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragging ? 'border-amber-400 bg-amber-400/10' : 'border-slate-700 hover:border-amber-400 bg-slate-950/60'
              }`}
            >
              <input type="file" accept="audio/*,video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Music className="w-7 h-7 mx-auto text-amber-400" />
              <span className="block mt-2 text-sm font-semibold text-white">{file ? file.name : t("Drop a song (MP3…) or a video here, or choose one")}</span>
              <span className="block mt-1 text-xs text-slate-400">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : t('Up to {n} MB', { n: maxMb })}</span>
            </label>
          )}
          <p className="text-xs text-slate-500">{t("From a video only the sound is used: its picture is replaced by the one you design below.")}</p>
        </Step>

        <Step n={2} title={t("Words")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">{t("Sung or spoken in")}</span>
              <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)} className={inputClass}>
                {SOURCE_LANGS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">{t("Translation (its own caption)")}</span>
              <select value={translateTo} onChange={(e) => setTranslateTo(e.target.value)} className={inputClass}>
                <option value={NO_TRANSLATION}>{t("No translation: the lyrics only")}</option>
                {(config?.languages ?? [{ code: 'ar', flag: '🇸🇦', en: 'Arabic', ar: 'العربية' }]).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {languageName(l.code, l)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Step>

        <Step n={3} title={t("The look")}>
          <StylePicker style={style} onChange={setStyle} lang={translateTo === NO_TRANSLATION ? 'en' : translateTo} sound />
        </Step>

        <CostPreview me={me ?? null} mode="hard" duration={source === 'upload' ? fileDuration : null} isLink={source === 'url'} onPricing={() => onPricing?.()} />

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 text-sm rounded-lg border border-rose-800 bg-rose-950/60 text-rose-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {(askConsent || !agreed) && legalVersion && <ConsentCheck checked={agreed} onChange={setAgreed} />}
        <button
          type="submit"
          disabled={busy !== null || (Boolean(legalVersion) && !agreed)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-base font-bold shadow-lg shadow-amber-400/20 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {busy ?? t("Make my lyrics video")}
        </button>
      </form>

      <div ref={resultRef} className="scroll-mt-20">
        {jobId && (
          <JobView
            key={jobId}
            jobId={jobId}
            config={config}
            localVideoUrl={null}
            onClose={() => onJob(null)}
            onRetried={(id) => onJob(id)}
            signedIn={Boolean(me?.account)}
            onSignIn={onSignIn}
          />
        )}
      </div>
    </div>
  );
}
