import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Link2, Loader2, Sparkles, Upload } from 'lucide-react';
import { ApiError, api, uploadFile, type AppConfig, type Job, type SubtitleMode } from '../lib/api';
import { JobView } from './JobView';

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
}

export function TranslateView({ config, jobId, onJob }: Props) {
  const [source, setSource] = useState<'url' | 'upload'>('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [srcLang, setSrcLang] = useState('auto');
  const [tgtLang, setTgtLang] = useState('ar');
  const [mode, setMode] = useState<SubtitleMode>('soft');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Object URL of the file uploaded in this session, used to preview soft-subtitle results.
  const [localVideo, setLocalVideo] = useState<{ jobId: string; url: string } | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => void (localVideo && URL.revokeObjectURL(localVideo.url)), [localVideo]);

  const maxMb = config?.max_upload_mb ?? 500;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const options = { src_lang: srcLang, tgt_lang: tgtLang, subtitle_mode: mode };
    try {
      let job: Job;
      if (source === 'url') {
        setBusy('Submitting…');
        job = await api.create({ ...options, video_url: videoUrl.trim() });
      } else {
        if (!file) throw new ApiError('E_NO_FILE', 'Choose a video or audio file first.');
        if (file.size > maxMb * 1024 * 1024) throw new ApiError('E_FILE_TOO_LARGE', `The file is larger than ${maxMb} MB.`);
        setBusy('Preparing upload…');
        job = await api.create({ ...options, upload: { name: file.name, size: file.size } });
        await uploadFile(
          job.upload_url!,
          file,
          (fraction) => setBusy(`Uploading… ${Math.round(fraction * 100)}%`),
          () => setBusy('Waking up the translation server (can take a couple of minutes)…'),
        );
        job = await api.start(job.id);
        setLocalVideo({ jobId: job.id, url: URL.createObjectURL(file) });
      }
      onJob(job.id);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Translate a video's speech into subtitles</h1>
        <p className="mt-2 text-sm text-slate-400 max-w-2xl">
          Paste a link or upload a file. You get a subtitle file (.srt / .vtt) in the language you choose, or the video
          with the subtitles burned in.
        </p>
      </div>

      <form onSubmit={submit} className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
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
            <span className="block mt-1.5 text-xs text-slate-500">
              YouTube, X, TikTok, Instagram, Vimeo, or a direct link to a video or audio file.
            </span>
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
            </select>
          </label>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 text-sm rounded-lg border border-rose-800 bg-rose-950/60 text-rose-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
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
          />
        )}
      </div>
    </div>
  );
}
