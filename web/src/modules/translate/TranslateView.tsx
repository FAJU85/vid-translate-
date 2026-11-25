import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ConsentCheck, useConsent } from '../../shared/consent';
import { AlertCircle, ArrowRight, AudioLines, Captions, Clapperboard, FileText, Link2, Loader2, Music, Share2, Sparkles, Upload } from 'lucide-react';
import { ApiError, api, type AppConfig, type Job, type Me, type SubtitleMode } from '../../shared/api';
import { CostPreview } from './CostPreview';
import { readDuration, uploadFile } from './upload';
import { JobView } from './JobView';
import { StylePicker, remember, rememberedStyle } from './StylePicker';
import { SITE } from '../../shared/content';
import { languageName, t } from '../../shared/i18n';

export const SOURCE_LANGS = [
  ['auto', t("Detect automatically")],
  ['en', t("English")],
  ['ar', t("Arabic")],
  ['fr', t("French")],
  ['es', t("Spanish")],
  ['de', t("German")],
  ['tr', t("Turkish")],
  ['ru', t("Russian")],
  ['fa', t("Persian")],
  ['ur', t("Urdu")],
  ['hi', t("Hindi")],
  ['zh', t("Chinese")],
  ['ja', t("Japanese")],
];

const inputClass =
  'w-full px-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400';

/** What a translation can give back: the three results, as choice cards. */
const RESULTS: { id: SubtitleMode; title: string; body: string; icon: typeof Captions }[] = [
  { id: 'soft', title: t("Subtitle files"), body: t("Fastest. .srt and .vtt files to add to any player."), icon: FileText },
  { id: 'hard', title: t("Subtitled video"), body: t("The video with the subtitles in it, styled your way."), icon: Captions },
  { id: 'dub', title: t("Dubbed video"), body: t("A translated voice over the original sound, plus subtitles."), icon: AudioLines },
];

/** A numbered part of the form. */
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
  /** Opens the feed (from the "watch translated videos" link). */
  onFeed?: () => void;
  /** A video link shared to the installed app: filled in, ready to translate. */
  initialLink?: string | null;
  jobId: string | null;
  onJob: (id: string | null) => void;
  /** A job was submitted (credits may have been set aside): refresh the balance shown. */
  onCreditsChanged?: () => void;
  /** Who is translating, their credits and free limits (credits on only). */
  me?: Me | null;
  onPricing?: () => void;
  onSignIn?: () => void;
  /** Goes up when a payment arrived: start again the video that was refused for credits. */
  resume?: number;
  /** Opens the Lyrics page (a song: a lyrics video is its own journey). */
  onLyrics?: () => void;
}

// Refusals the website answers with an offer: more credits, or signing in for free ones.
const CREDIT_ERRORS = new Set(['E_NO_CREDITS', 'E_FREE_LIMIT', 'E_DUB_PAID']);

export function TranslateView({ config, jobId, onJob, onCreditsChanged, me, onPricing, onSignIn, onFeed, initialLink, resume = 0, onLyrics }: Props) {
  const [dragging, setDragging] = useState(false);
  // PDPL: agreed to the Terms and Privacy Policy (ticked once per version, in this browser).
  const legalVersion = config?.legal_version ?? '';
  const [agreed, setAgreed] = useConsent(legalVersion);
  const [askConsent] = useState(() => !agreed);
  const [source, setSource] = useState<'url' | 'upload'>('url');
  const [videoUrl, setVideoUrl] = useState(initialLink ?? '');
  // A site whose downloads have been failing lately (learned from every download): said before starting.
  const [troubleHost, setTroubleHost] = useState<string | null>(null);
  useEffect(() => {
    const link = videoUrl.trim();
    setTroubleHost(null);
    if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(link)) return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .siteStatus(link)
        .then((s) => current && setTroubleHost(s.status === 'trouble' ? s.host : null))
        .catch(() => {});
    }, 600);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [videoUrl]);
  const [file, setFile] = useState<File | null>(null);
  const [srcLang, setSrcLang] = useState('auto');
  const [tgtLang, setTgtLang] = useState('ar');
  const [mode, setMode] = useState<SubtitleMode>('soft');
  // A song or a podcast (an audio file): its lyrics video is made on the Lyrics page.
  const soundOnly = source === 'upload' && Boolean(file?.type.startsWith('audio/'));
  const [style, setStyle] = useState(rememberedStyle);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The chosen file's length, read by the browser, for the cost preview.
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  useEffect(() => {
    setFileDuration(null);
    if (!file || !me?.credits_enabled) return;
    let live = true;
    readDuration(file).then((d) => live && setFileDuration(d));
    return () => {
      live = false;
    };
  }, [file, me?.credits_enabled]);
  // Object URL of the file uploaded in this session, used to preview soft-subtitle results.
  const [localVideo, setLocalVideo] = useState<{ jobId: string; url: string } | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => void (localVideo && URL.revokeObjectURL(localVideo.url)), [localVideo]);

  const maxMb = config?.max_upload_mb ?? 500;
  // No voice at all for Hausa; Kurdish only has the classic one (worker jobs/style.ts).
  const canDub = tgtLang !== 'ha';
  const classicOnly = tgtLang === 'ku';
  useEffect(() => {
    if (!canDub && mode === 'dub') setMode('soft');
  }, [canDub, mode]);

  // Paid after a refusal: the same video (link or file, still in this tab) starts again.
  const formRef = useRef<HTMLFormElement | null>(null);
  // Changing the video or its options after a refusal means it is not the same request any more.
  useEffect(() => setErrorCode(null), [source, videoUrl, file, srcLang, tgtLang, mode]);
  useEffect(() => {
    if (resume && errorCode && CREDIT_ERRORS.has(errorCode)) formRef.current?.requestSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    const options = { src_lang: srcLang, tgt_lang: tgtLang, subtitle_mode: mode, consent: legalVersion, ...(mode !== 'soft' ? { style } : {}) };
    try {
      let job: Job;
      if (source === 'url') {
        setBusy(t("Submitting…"));
        job = await api.create({ ...options, video_url: videoUrl.trim() });
      } else {
        if (!file) throw new ApiError('E_NO_FILE', t("Choose a video or audio file first."));
        if (file.size > maxMb * 1024 * 1024) throw new ApiError('E_FILE_TOO_LARGE', t('The file is larger than {n} MB.', { n: maxMb }));
        setBusy(t("Preparing upload…"));
        const duration = await readDuration(file); // lets the server estimate the cost before the upload
        job = await api.create({ ...options, duration, upload: { name: file.name, size: file.size, duration } });
        await uploadFile(
          job.upload_url!,
          file,
          (fraction) => setBusy(t('Uploading… {n}%', { n: Math.round(fraction * 100) })),
          () => setBusy(t("Waking up the translation server (can take a couple of minutes)…")),
        );
        job = await api.start(job.id, duration);
        setLocalVideo({ jobId: job.id, url: URL.createObjectURL(file) });
      }
      onJob(job.id);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong."));
      setErrorCode(err instanceof ApiError ? err.code : null);
    } finally {
      setBusy(null);
      onCreditsChanged?.();
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-100 max-w-3xl">{SITE.translate.title}</h1>
        <p className="text-sm md:text-base text-slate-400 max-w-2xl">{SITE.translate.intro}</p>
        {/* The whole journey at a glance: add a video, choose, then watch and share. */}
        <ol className="grid grid-cols-3 gap-2 text-sm">
          {(
            [
              [Upload, t("Add a video"), t("A link or a file")],
              [Sparkles, t("Choose a language"), t("Subtitles or a dubbed voice")],
              [Share2, t("Watch and share"), t("Download, share a link, or post it")],
            ] as const
          ).map(([Icon, title, body], i) => (
            <li key={title} className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl border border-slate-800 bg-slate-900/60 text-center sm:text-start">
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
        {onFeed && (
          <button type="button" onClick={onFeed} className="inline-flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200">
            <Clapperboard className="w-4 h-4" />{' '}{t("Watch videos others translated")}{' '}<ArrowRight className="rtl:-scale-x-100 w-4 h-4" />
          </button>
        )}
      </div>

      <form ref={formRef} onSubmit={submit} className="p-5 md:p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20 space-y-6">
        <Step n={1} title={t("Your video")}>
        <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 text-sm">
          {(
            [
              ['url', t("Video link"), Link2],
              ['upload', t("Upload a file"), Upload],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSource(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${
                source === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {source === 'url' ? (
          <label className="block">
            <span className="block text-sm font-medium text-slate-200 mb-1.5">{t("Video link")}</span>
            <input
              type="url"
              dir="ltr"
              required
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder={t("https://…")}
              className={inputClass}
            />
            <span className="block mt-1.5 text-xs text-slate-500">{SITE.translate.link_hint}</span>
            {troubleHost && (
              <span role="status" className="block mt-1.5 text-xs text-amber-300">
                {t("Downloads from")}{' '}{troubleHost}{' '}{t("have been failing lately. You can still try, or download the video yourself and upload the file.")}
              </span>
            )}
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
            <input
              type="file"
              accept="video/*,audio/*"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload className="w-7 h-7 mx-auto text-amber-400" />
            <span className="block mt-2 text-sm font-semibold text-white">{file ? file.name : t("Drop a video or audio file here, or choose one")}</span>
            <span className="block mt-1 text-xs text-slate-400">
              {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : t('Up to {n} MB', { n: maxMb })}
            </span>
          </label>
        )}

        {soundOnly && onLyrics && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            <Music className="w-3.5 h-3.5 text-amber-300" /> {t("A song or a podcast?")}
            <button type="button" onClick={onLyrics} className="text-amber-300 hover:text-amber-200 underline">
              {t("Make a lyrics video instead")}
            </button>
          </p>
        )}
        </Step>

        <Step n={2} title={t("Languages")}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">{t("Spoken in the video")}</span>
            <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)} className={inputClass}>
              {SOURCE_LANGS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <ArrowRight className="rtl:-scale-x-100 hidden sm:block w-5 h-5 mb-3 text-slate-500" aria-hidden />
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">{t("Translate into")}</span>
            <select value={tgtLang} onChange={(e) => setTgtLang(e.target.value)} className={inputClass}>
              {(config?.languages ?? [{ code: 'ar', flag: '🇸🇦', en: 'Arabic', ar: 'العربية' }]).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {languageName(l.code, l)}
                </option>
              ))}
            </select>
          </label>
        </div>
        </Step>

        <Step n={3} title={t("What you get")}>
        {/* Native radio buttons inside the cards: one Tab stop, arrow keys move the choice. */}
        <div role="radiogroup" aria-label={t("Result")} className="grid gap-2 sm:grid-cols-3">
          {RESULTS.map((r) => {
            const off = r.id === 'dub' && !canDub;
            const on = mode === r.id;
            return (
              <label
                key={r.id}
                className={`block p-3.5 rounded-xl border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-400 ${
                  off ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                } ${on ? 'border-amber-400 bg-amber-400/10' : 'border-slate-700 bg-slate-950/50 hover:border-slate-500'}`}
              >
                <input type="radio" name="result" value={r.id} checked={on} disabled={off} onChange={() => setMode(r.id)} className="sr-only" />
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <r.icon className={`w-4 h-4 ${on ? 'text-amber-300' : 'text-slate-400'}`} />
                  {r.title}
                </span>
                <span className="block mt-1 text-xs text-slate-400">{off ? t("Not available for this language yet.") : r.body}</span>
              </label>
            );
          })}
        </div>

        {mode === 'hard' && <StylePicker style={style} onChange={setStyle} lang={tgtLang} />}
        {mode === 'dub' && (
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
            <div className="text-sm font-medium text-slate-200">{t("Voice")}</div>
            <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 text-sm">
              {(['female', 'male', 'classic'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={classicOnly && v !== 'classic'}
                  onClick={() => {
                    const next = { ...style, voice: v };
                    remember(next);
                    setStyle(next);
                  }}
                  aria-pressed={(classicOnly ? 'classic' : style.voice ?? 'female') === v}
                  className={`px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${(classicOnly ? 'classic' : style.voice ?? 'female') === v ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}
                >
                  {v === 'female' ? t("Female") : v === 'male' ? t("Male") : t("Classic")}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {classicOnly && t("Kurdish has no Microsoft Edge voice, so it is spoken by the classic voice. ")}
              {classicOnly || style.voice === 'classic'
                ? t("Spoken by eSpeak NG, a rule-based voice (no AI): clear and predictable, but it sounds synthetic.")
                : t("Each sentence is spoken in the target language by a Microsoft Edge voice, timed to the speaker, over the original sound turned down low.")}{' '}
              {t("You also get the subtitle files.")}
            </p>
          </div>
        )}

        </Step>

        <CostPreview
          me={me ?? null}
          mode={mode}
          duration={source === 'upload' ? fileDuration : null}
          isLink={source === 'url'}
          onPricing={() => onPricing?.()}
        />

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 text-sm rounded-lg border border-rose-800 bg-rose-950/60 text-rose-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-2">
              <span>{error}</span>
              {errorCode && CREDIT_ERRORS.has(errorCode) && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => onPricing?.()} className="px-3 py-1.5 rounded-lg bg-amber-400 text-xs font-semibold text-slate-950 hover:bg-amber-300">
                    {t("See plans and credit packs")}
                  </button>
                  {!me?.account && (
                    <button type="button" onClick={() => onSignIn?.()} className="px-3 py-1.5 rounded-lg border border-slate-600 text-xs text-slate-100 hover:bg-slate-800">
                      {t("Sign in for free credits")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {(askConsent || !agreed) && legalVersion && <ConsentCheck checked={agreed} onChange={setAgreed} />}
        <button
          type="submit"
          disabled={busy !== null || (Boolean(legalVersion) && !agreed)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-base font-bold shadow-lg shadow-amber-400/20 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ??
            t(mode === 'dub' ? 'Dub into {lang}' : 'Translate into {lang}', {
              lang: languageName(tgtLang, config?.languages.find((l) => l.code === tgtLang)) || t('your language'),
            })}
        </button>
      </form>

      <div ref={resultRef} className="scroll-mt-20">
        {jobId && (
          <JobView
            key={jobId}
            jobId={jobId}
            config={config}
            localVideoUrl={localVideo?.jobId === jobId ? localVideo.url : null}
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
