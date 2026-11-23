import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Link2, Loader2, Sparkles, Upload } from 'lucide-react';
import { ApiError, api, type AppConfig, type Job, type Me, type SubtitleMode } from '../../shared/api';
import { CostPreview } from './CostPreview';
import { readDuration, uploadFile } from './upload';
import { JobView } from './JobView';
import { StylePicker, remember, rememberedStyle } from './StylePicker';
import { SITE } from '../../shared/content';

const SOURCE_LANGS = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['ar', 'Arabic'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['de', 'German'],
  ['tr', 'Turkish'],
  ['ru', 'Russian'],
  ['fa', 'Persian'],
  ['ur', 'Urdu'],
  ['hi', 'Hindi'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
];

const inputClass =
  'w-full px-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400';

interface Props {
  config: AppConfig | null;
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
}

// Refusals the website answers with an offer: more credits, or signing in for free ones.
const CREDIT_ERRORS = new Set(['E_NO_CREDITS', 'E_FREE_LIMIT', 'E_DUB_PAID']);

export function TranslateView({ config, jobId, onJob, onCreditsChanged, me, onPricing, onSignIn, resume = 0 }: Props) {
  const [source, setSource] = useState<'url' | 'upload'>('url');
  const [videoUrl, setVideoUrl] = useState('');
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
    const options = { src_lang: srcLang, tgt_lang: tgtLang, subtitle_mode: mode, ...(mode !== 'soft' ? { style } : {}) };
    try {
      let job: Job;
      if (source === 'url') {
        setBusy('Submitting…');
        job = await api.create({ ...options, video_url: videoUrl.trim() });
      } else {
        if (!file) throw new ApiError('E_NO_FILE', 'Choose a video or audio file first.');
        if (file.size > maxMb * 1024 * 1024) throw new ApiError('E_FILE_TOO_LARGE', `The file is larger than ${maxMb} MB.`);
        setBusy('Preparing upload…');
        const duration = await readDuration(file); // lets the server estimate the cost before the upload
        job = await api.create({ ...options, duration, upload: { name: file.name, size: file.size, duration } });
        await uploadFile(
          job.upload_url!,
          file,
          (fraction) => setBusy(`Uploading… ${Math.round(fraction * 100)}%`),
          () => setBusy('Waking up the translation server (can take a couple of minutes)…'),
        );
        job = await api.start(job.id, duration);
        setLocalVideo({ jobId: job.id, url: URL.createObjectURL(file) });
      }
      onJob(job.id);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setErrorCode(err instanceof ApiError ? err.code : null);
    } finally {
      setBusy(null);
      onCreditsChanged?.();
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">{SITE.translate.title}</h1>
        <p className="mt-2 text-sm text-slate-400 max-w-2xl">{SITE.translate.intro}</p>
      </div>

      <form ref={formRef} onSubmit={submit} className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
        <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 text-sm">
          {(
            [
              ['url', 'Video link', Link2],
              ['upload', 'Upload a file', Upload],
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
            <span className="block text-sm font-medium text-slate-200 mb-1.5">Video link</span>
            <input
              type="url"
              required
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://…"
              className={inputClass}
            />
            <span className="block mt-1.5 text-xs text-slate-500">{SITE.translate.link_hint}</span>
            {troubleHost && (
              <span role="status" className="block mt-1.5 text-xs text-amber-300">
                Downloads from {troubleHost} have been failing lately. You can still try, or download the video yourself and
                upload the file.
              </span>
            )}
          </label>
        ) : (
          <label className="block cursor-pointer rounded-xl border border-dashed border-slate-700 hover:border-amber-400 bg-slate-950/60 p-6 text-center">
            <input
              type="file"
              accept="video/*,audio/*"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Upload className="w-7 h-7 mx-auto text-amber-400" />
            <span className="block mt-2 text-sm font-semibold text-white">{file ? file.name : 'Choose a video or audio file'}</span>
            <span className="block mt-1 text-xs text-slate-400">
              {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `Up to ${maxMb} MB`}
            </span>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="block text-sm font-medium text-slate-200 mb-1.5">Spoken language</span>
            <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)} className={inputClass}>
              {SOURCE_LANGS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-200 mb-1.5">Translate into</span>
            <select value={tgtLang} onChange={(e) => setTgtLang(e.target.value)} className={inputClass}>
              {(config?.languages ?? [{ code: 'ar', flag: '🇸🇦', en: 'Arabic', ar: '' }]).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.en}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-200 mb-1.5">Result</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as SubtitleMode)} className={inputClass}>
              <option value="soft">Subtitle files only (faster)</option>
              <option value="hard">Video with burned-in subtitles</option>
              <option value="dub" disabled={!canDub}>
                Dubbed video (translated voice){canDub ? '' : ': not for this language'}
              </option>
            </select>
          </label>
        </div>

        {mode === 'hard' && <StylePicker style={style} onChange={setStyle} lang={tgtLang} />}
        {mode === 'dub' && (
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
            <div className="text-sm font-medium text-slate-200">Voice</div>
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
                  {v === 'female' ? 'Female' : v === 'male' ? 'Male' : 'Classic'}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {classicOnly && 'Kurdish has no Microsoft Edge voice, so it is spoken by the classic voice. '}
              {classicOnly || style.voice === 'classic'
                ? 'Spoken by eSpeak NG, a rule-based voice (no AI): clear and predictable, but it sounds synthetic.'
                : 'Each sentence is spoken in the target language by a Microsoft Edge voice, timed to the speaker, over the original sound turned down low.'}{' '}
              You also get the subtitle files.
            </p>
          </div>
        )}

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
                    See plans and credit packs
                  </button>
                  {!me?.account && (
                    <button type="button" onClick={() => onSignIn?.()} className="px-3 py-1.5 rounded-lg border border-slate-600 text-xs text-slate-100 hover:bg-slate-800">
                      Sign in for free credits
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={busy !== null}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ?? 'Translate'}
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
          />
        )}
      </div>
    </div>
  );
}
