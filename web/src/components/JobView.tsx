import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Download, Link2, Loader2, Pencil, X } from 'lucide-react';
import { RTL, STAGE_LABEL, api, cuesToSrt, jobError, timestamp, type AppConfig, type Cue, type Job } from '../lib/api';

interface Props {
  jobId: string;
  config: AppConfig | null;
  localVideoUrl: string | null;
  onClose: () => void;
}

const ACTIVE = new Set(['awaiting_upload', 'queued', 'running']);

export function JobView({ jobId, config, localVideoUrl, onClose }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [edited, setEdited] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Poll while the job is in progress.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await api.job(jobId);
        if (stopped) return;
        setJob(next);
        setLoadError(null);
        if (ACTIVE.has(next.status)) timer = setTimeout(tick, 2500);
      } catch (err) {
        if (stopped) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load this translation.');
        timer = setTimeout(tick, 6000);
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const cuesUrl = job?.outputs.cues_url;
  useEffect(() => {
    if (!cuesUrl) return;
    fetch(cuesUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setCues(data.cues))
      .catch(() => setCues([]));
  }, [cuesUrl]);

  const langName = (code: string | null) => config?.languages.find((l) => l.code === code)?.en ?? code ?? '';
  const dir = job && RTL.has(job.tgt_lang) ? 'rtl' : 'ltr';
  const videoUrl = job?.outputs.mp4_url ?? localVideoUrl;
  const burnedIn = Boolean(job?.outputs.mp4_url);
  const current = useMemo(() => cues?.find((c) => time >= c.start && time < c.end), [cues, time]);

  const editedSrtUrl = useMemo(
    () => (edited && cues ? URL.createObjectURL(new Blob([cuesToSrt(cues)], { type: 'application/x-subrip' })) : null),
    [edited, cues],
  );
  useEffect(() => () => void (editedSrtUrl && URL.revokeObjectURL(editedSrtUrl)), [editedSrtUrl]);

  if (!job) {
    return (
      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 text-sm text-slate-300 flex items-center gap-2">
        {loadError ? <AlertCircle className="w-4 h-4 text-rose-400" /> : <Loader2 className="w-4 h-4 animate-spin" />}
        {loadError ?? 'Loading…'}
      </section>
    );
  }

  const active = ACTIVE.has(job.status);
  const title = job.title ?? job.source_url ?? 'Video';
  const downloads: [string, string | undefined][] = [
    [`Subtitles (.srt)`, job.outputs.srt_url],
    ['Subtitles (.vtt)', job.outputs.vtt_url],
    ['Original transcript (.srt)', job.outputs.original_srt_url],
    ['Subtitled video (.mp4)', job.outputs.mp4_url],
  ];

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-white truncate">{title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {job.detected_lang ? `${langName(job.detected_lang)} → ` : 'To '}
              {langName(job.tgt_lang)}
              {job.duration ? ` · ${Math.floor(job.duration / 60)}:${String(Math.round(job.duration % 60)).padStart(2, '0')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {active && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-amber-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                {STAGE_LABEL[job.status === 'running' ? job.stage : job.stage === 'waking' ? 'waking' : job.status] ?? job.stage}
              </span>
              <span className="font-mono text-slate-300">{job.progress}%</span>
            </div>
            <div
              className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden"
              role="progressbar"
              aria-valuenow={job.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${job.progress}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>You can leave this page open or come back later from “My translations”.</span>
              <button
                onClick={() => api.cancel(job.id).then(setJob).catch(() => {})}
                className="text-slate-300 hover:text-white underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {(job.status === 'failed' || job.status === 'cancelled') && (
          <div role="alert" className="flex items-start gap-2 p-3 text-sm rounded-lg border border-rose-800 bg-rose-950/60 text-rose-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{job.status === 'cancelled' ? 'This translation was cancelled.' : jobError(job)}</span>
          </div>
        )}

        {job.status === 'done' && (
          <>
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="w-4 h-4" />
              Ready. Files stay available for 24 hours.
            </div>
            <div className="flex flex-wrap gap-2">
              {downloads.map(
                ([label, url], i) =>
                  url && (
                    <a
                      key={label}
                      href={url}
                      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-semibold ${
                        i === 0 ? 'bg-amber-400 hover:bg-amber-300 text-slate-950' : 'border border-slate-700 text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <Download className="w-4 h-4" />
                      {label}
                    </a>
                  ),
              )}
              {editedSrtUrl && (
                <a
                  href={editedSrtUrl}
                  download={`${title}.${job.tgt_lang}.edited.srt`}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-semibold border border-amber-400/60 text-amber-300 hover:bg-amber-400/10"
                >
                  <Download className="w-4 h-4" />
                  Edited subtitles (.srt)
                </a>
              )}
            </div>
            {job.mode === 'hard' && !job.outputs.mp4_url && (
              <p className="text-xs text-slate-400">The source has no picture, so only subtitle files were produced.</p>
            )}
          </>
        )}
      </div>

      {job.status === 'done' && videoUrl && (
        <div className="relative bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="w-full max-h-[70vh]"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          />
          {!burnedIn && current && (
            <div className="absolute inset-x-4 bottom-14 flex justify-center pointer-events-none">
              <span dir={dir} className="px-3 py-1.5 rounded-lg bg-black/80 text-white text-base md:text-lg font-semibold text-center">
                {current.translation}
              </span>
            </div>
          )}
        </div>
      )}

      {job.status === 'done' && cues && cues.length > 0 && (
        <div className="border-t border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-white">
            Subtitles <span className="text-slate-500 font-normal">({cues.length} lines)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-3">
            Fix any line with the pencil, then download the edited .srt.
          </p>
          <ul className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {cues.map((cue, i) => (
              <li
                key={cue.index}
                className={`p-3 rounded-xl border text-sm ${
                  current?.index === cue.index ? 'border-amber-400 bg-amber-950/20' : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    className="font-mono text-xs text-amber-400 hover:underline"
                    onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime = cue.start;
                    }}
                  >
                    {timestamp(cue.start, '.').slice(0, 8)} – {timestamp(cue.end, '.').slice(0, 8)}
                  </button>
                  <button
                    aria-label={editing === cue.index ? 'Finish editing' : 'Edit line'}
                    onClick={() => setEditing(editing === cue.index ? null : cue.index)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    {editing === cue.index ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <p className="text-slate-400 leading-relaxed" dir="auto">
                    {cue.text}
                  </p>
                  {editing === cue.index ? (
                    <textarea
                      dir={dir}
                      autoFocus
                      rows={2}
                      value={cue.translation}
                      onChange={(e) => {
                        setCues(cues.map((c, j) => (j === i ? { ...c, translation: e.target.value } : c)));
                        setEdited(true);
                      }}
                      className="w-full p-2 rounded-lg bg-slate-900 border border-amber-400/60 text-white focus:outline-none"
                    />
                  ) : (
                    <p dir={dir} className="text-white font-medium leading-relaxed">
                      {cue.translation}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
