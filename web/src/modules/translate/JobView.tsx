import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Crosshair, Download, Film, Link2, Loader2, Pencil, RotateCcw, Search, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { api, type AppConfig, type Cue, type Job, type RatingAspect } from '../../shared/api';
import { ShareLink } from './ShareLink';
import { Progress } from './Progress';
import { PostToProfile } from './PostToProfile';
import { RTL, STAGE_LABEL, cuesToSrt, jobError, timestamp, tokens, wordAt, wordTimes } from './format';
import { languageName, plural, t } from '../../shared/i18n';

interface Props {
  jobId: string;
  config: AppConfig | null;
  localVideoUrl: string | null;
  onClose: () => void;
  /** A retry runs as a new job: show that one instead. */
  onRetried: (jobId: string) => void;
  /** Signed in with an account (not a guest): the result offers posting to the profile. */
  signedIn?: boolean;
  onSignIn?: () => void;
}

const ACTIVE = new Set(['awaiting_upload', 'queued', 'running']);

/** "You're #2 in line · about 6 min" while waiting, "About 4 min left" while running. */
function waitLine(job: Job): string | null {
  if (!job.eta_seconds) return null;
  const min = Math.max(1, Math.round(job.eta_seconds / 60));
  if (job.status === 'queued' && job.queue_position && job.queue_position >= 1) {
    return t("You're #{pos} in line · about {n} min", { pos: job.queue_position, n: min });
  }
  return job.status === 'running' ? t('About {n} min left', { n: min }) : null;
}

export function JobView({ jobId, config, localVideoUrl, onClose, onRetried, signedIn = false, onSignIn }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [edited, setEdited] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  // Corrections sent to the translation memory (once per version of the edits).
  const [taught, setTaught] = useState<{ learned: number; signed_in: boolean } | null>(null);
  // Sent once per version of the edits: while sending, and after it counted. Not after a failure
  // or while signed out, so it is sent again later (after signing in, for example).
  const taughtFor = useRef<{ sending: string; done: string }>({ sending: '', done: '' });
  const teach = () => {
    if (!job || !cues || !edited) return;
    const key = JSON.stringify(cues.map((c) => [c.text, c.translation])); // the words heard teach too
    if (taughtFor.current.sending === key || taughtFor.current.done === key) return;
    taughtFor.current.sending = key;
    api
      .corrections(job.id, cues)
      .then((result) => {
        setTaught(result);
        if (result.signed_in) taughtFor.current.done = key;
      })
      .catch(() => {})
      .finally(() => {
        if (taughtFor.current.sending === key) taughtFor.current.sending = '';
      });
  };
  const [renderError, setRenderError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Interactive transcript: which text to show, whether it follows the video, and a search.
  const [view, setView] = useState<'both' | 'translation' | 'original'>('both');
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);
  const programmaticScroll = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
        setLoadError(err instanceof Error ? err.message : t("Could not load this translation."));
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

  const langName = (code: string | null) => languageName(code, config?.languages.find((l) => l.code === code));
  const dir = job && RTL.has(job.tgt_lang) ? 'rtl' : 'ltr';
  const videoUrl = job?.outputs.mp4_url ?? job?.outputs.dubbed_url ?? localVideoUrl;
  const burnedIn = Boolean(job?.outputs.mp4_url);
  const current = useMemo(() => cues?.find((c) => time >= c.start && time < c.end), [cues, time]);

  // The player's own time updates come about four times a second: too coarse to light words, so
  // while it plays the time is read every frame.
  const playing = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const loop = () => {
      setTime(video.currentTime);
      if (playing.current) frame = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      playing.current = true;
      frame = requestAnimationFrame(loop);
    };
    const onPause = () => {
      playing.current = false;
      cancelAnimationFrame(frame);
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    if (!video.paused) onPlay();
    return () => {
      onPause();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [job?.status, videoUrl]);

  // Keep the line being spoken in view in the transcript (scrolling the list, never the page).
  useEffect(() => {
    const list = listRef.current;
    const row = current && list?.querySelector<HTMLElement>(`[data-cue="${current.index}"]`);
    if (!follow || !list || !row) return;
    // The list is the rows' offset parent (it is `relative`), so offsetTop is already within it.
    const top = row.offsetTop - list.clientHeight / 3;
    programmaticScroll.current = true;
    list.scrollTo({ top, behavior: 'smooth' });
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => (programmaticScroll.current = false), 700);
  }, [current?.index, follow]);

  const seek = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t + 0.01;
    setTime(t + 0.01);
    setFollow(true);
    video.play().catch(() => {}); // "click a word to play from there" (a browser may refuse: then it just moves)
  };
  const q = query.trim().toLowerCase();
  // [cue, its index]: a search keeps the line being edited, even once the edit no longer matches.
  const shownCues = useMemo(
    () =>
      cues
        ?.map((c, i) => [c, i] as const)
        .filter(([c]) => !q || c.index === editing || c.text.toLowerCase().includes(q) || c.translation.toLowerCase().includes(q)),
    [cues, q, editing],
  );

  /** A line as clickable words; the one being spoken is lit, search matches are marked. */
  const renderWords = (cue: Cue, text: string, rtl: boolean, lit: boolean) => {
    const list = tokens(text);
    const times = wordTimes(list.map((t) => t.text), cue.start, cue.end);
    const at = lit && current?.index === cue.index ? wordAt(times, time) : -1;
    return (
      <span dir={rtl ? 'rtl' : 'auto'}>
        {list.map(({ text: w, space }, i) => (
          <span key={i}>
            <button
              type="button"
              onClick={() => seek(times[i][0])}
              title={t('Play from {time}', { time: timestamp(times[i][0], '.').slice(3, 8) })}
              className={`rounded px-0.5 -mx-0.5 transition-colors hover:bg-slate-700 ${
                i === at ? 'bg-amber-400 text-slate-950' : q && w.toLowerCase().includes(q) ? 'bg-sky-500/30' : ''
              }`}
            >
              {w}
            </button>
            {space ? ' ' : ''}
          </span>
        ))}
      </span>
    );
  };

  const editedSrtUrl = useMemo(
    () => (edited && cues ? URL.createObjectURL(new Blob([cuesToSrt(cues)], { type: 'application/x-subrip' })) : null),
    [edited, cues],
  );
  useEffect(() => () => void (editedSrtUrl && URL.revokeObjectURL(editedSrtUrl)), [editedSrtUrl]);

  if (!job) {
    return (
      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 text-sm text-slate-300 flex items-center gap-2">
        {loadError ? <AlertCircle className="w-4 h-4 text-rose-400" /> : <Loader2 className="w-4 h-4 animate-spin" />}
        {loadError ?? t("Loading…")}
      </section>
    );
  }

  const active = ACTIVE.has(job.status);
  const title = job.title ?? job.source_url ?? t("Video");
  const downloads: [string, string | undefined][] = [
    [t("Subtitles (.srt)"), job.outputs.srt_url],
    [t("Subtitles (.vtt)"), job.outputs.vtt_url],
    [t("Original transcript (.srt)"), job.outputs.original_srt_url],
    [t("Both languages (.srt)"), job.outputs.bilingual_srt_url],
    [t("Transcript (.txt)"), job.outputs.transcript_url],
    [t("Subtitled video (.mp4)"), job.outputs.mp4_url],
    [t("Dubbed video (.mp4)"), job.outputs.dubbed_url],
  ];

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-white truncate">{title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {job.detected_lang ? `${langName(job.detected_lang)} → ` : t("To ")}
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
              {copied ? t("Copied") : t("Copy link")}
            </button>
            <button onClick={onClose} aria-label={t("Close")} className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {active && (
          <div className="space-y-3">
            <Progress job={job} />
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-rose-300">
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
              <div className="h-full bg-gradient-to-r from-amber-400 to-rose-400 transition-all duration-500" style={{ width: `${job.progress}%` }} />
            </div>
            {waitLine(job) && <p className="text-sm text-slate-300">{waitLine(job)}</p>}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{t("You can leave this page open or come back later from your Dashboard.")}</span>
              <button
                onClick={() => api.cancel(job.id).then(setJob).catch(() => {})}
                className="text-slate-300 hover:text-white underline"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}

        {(job.status === 'failed' || job.status === 'cancelled') && (
          <div role="alert" className="flex items-start gap-2 p-3 text-sm rounded-lg border border-rose-800 bg-rose-950/60 text-rose-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{job.status === 'cancelled' ? t("This translation was cancelled.") : jobError(job)}</span>
            {job.can_retry ? (
              <button
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  setRetryError(null);
                  api
                    .retry(job.id)
                    .then((next) => onRetried(next.id))
                    .catch((err) => setRetryError(err instanceof Error ? err.message : t("Could not try again.")))
                    .finally(() => setRetrying(false));
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 text-xs font-semibold"
              >
                {retrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {t("Try again")}
              </button>
            ) : (
              job.source_url === null && (
                <button onClick={onClose} className="shrink-0 px-3 py-1 rounded-lg border border-rose-700 text-xs text-rose-100 hover:bg-rose-900/50">
                  {t("Upload again")}
                </button>
              )
            )}
          </div>
        )}
        {retryError && <p className="text-xs text-rose-300">{retryError}</p>}

        {job.status === 'done' && (
          <>
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </span>
              <span>
                {/* Subtitle files from a link have no video to watch here: say what there is. */}
                <span className="block font-semibold text-slate-100">{videoUrl ? t("Your video is ready") : t("Your subtitles are ready")}</span>
                <span className="block text-xs text-slate-400">
                  {videoUrl ? t("Watch it below.") : t("Download the files below.")}{' '}{t("Files stay available for 24 hours.")}
                </span>
              </span>
            </div>
            {job.share_url && <ShareLink url={job.share_url} />}
            {job.share_url && <PostToProfile shareUrl={job.share_url} signedIn={signedIn} onSignIn={onSignIn} />}
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
                  onClick={teach}
                  download={`${title}.${job.tgt_lang}.edited.srt`}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-semibold border border-amber-400/60 text-amber-300 hover:bg-amber-400/10"
                >
                  <Download className="w-4 h-4" />
                  {t("Edited subtitles (.srt)")}
                </a>
              )}
            </div>
            {taught && (
              <p className="text-xs text-slate-400">
                {taught.signed_in
                  ? taught.learned
                    ? plural(taught.learned, 'Thank you: {n} correction counted. When enough people make the same correction, KAVOX learns it for everyone.', 'Thank you: {n} corrections counted. When enough people make the same correction, KAVOX learns it for everyone.')
                    : t("Thank you. Corrections to the words heard or the translation (not the timing) teach KAVOX.")
                  : t("Sign in so your corrections teach KAVOX to translate better for everyone.")}
              </p>
            )}
            {job.status === 'done' && <Rating job={job} onCorrect={() => setEditing(cues?.[0]?.index ?? null)} />}
            {edited && cues && job.can_rerender && (
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-amber-400/40 bg-amber-400/5">
                <span className="flex-1 min-w-[12rem] text-sm text-amber-100">
                  {t("You changed the subtitles. Render the video again with your changes (only the burn-in runs, so it is quick).")}
                </span>
                <button
                  disabled={rendering}
                  onClick={() => {
                    teach();
                    setRendering(true);
                    setRenderError(null);
                    api
                      .render(job.id, cues)
                      .then((next) => onRetried(next.id))
                      .catch((err) => setRenderError(err instanceof Error ? err.message : t("Could not start the render.")))
                      .finally(() => setRendering(false));
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 text-sm font-semibold"
                >
                  {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                  {t("Render video with my edits")}
                </button>
                {renderError && <p className="w-full text-xs text-rose-300">{renderError}</p>}
              </div>
            )}
            {((job.mode === 'hard' && !job.outputs.mp4_url) || (job.mode === 'dub' && !job.outputs.dubbed_url)) && (
              <p className="text-xs text-slate-400">{t("The source has no picture, so only subtitle files were produced.")}</p>
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
                {/* Dynamic captions: the word being spoken is lit. */}
                {(() => {
                  const list = tokens(current.translation);
                  const at = wordAt(wordTimes(list.map((t) => t.text), current.start, current.end), time);
                  return list.map(({ text: w, space }, i) => (
                    <span key={i} className={i === at ? 'text-amber-300' : undefined}>
                      {w}
                      {space ? ' ' : ''}
                    </span>
                  ));
                })()}
              </span>
            </div>
          )}
        </div>
      )}

      {job.status === 'done' && cues && cues.length > 0 && shownCues && (
        <div className="border-t border-slate-800 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              {t("Interactive transcript")}{' '}<span className="text-slate-500 font-normal">({cues.length}{' '}{t("lines)")}</span>
            </h3>
            <div className="inline-flex p-0.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              {(
                [
                  ['both', t("Both")],
                  ['translation', t("Translation")],
                  ['original', t("Original")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  className={`px-2.5 py-1 rounded-md ${view === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {t("Click any word to play from there. Fix a line with the pencil, then download the edited .srt or, for a video with burned-in subtitles, render it again.")}
          </p>
          <div className="mt-3 mb-3 flex items-center gap-2">
            <label className="relative flex-1">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search the transcript")}
                className="w-full ps-8 pe-3 py-1.5 text-sm rounded-lg bg-slate-950 border border-slate-800 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
            {q && <span className="text-xs text-slate-400 tabular-nums">{shownCues.length}{' '}{t("found")}</span>}
            {!follow && videoUrl && (
              <button
                type="button"
                onClick={() => setFollow(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800"
              >
                <Crosshair className="w-3.5 h-3.5" />{' '}{t("Follow video")}
              </button>
            )}
          </div>
          <ul
            ref={listRef}
            onScroll={() => {
              if (!programmaticScroll.current) return setFollow(false); // scrolled by hand: stop following
              // Our own smooth scroll: stay "ours" until its last scroll event has passed.
              clearTimeout(scrollTimer.current);
              scrollTimer.current = setTimeout(() => (programmaticScroll.current = false), 150);
            }}
            className="relative space-y-2 max-h-[28rem] overflow-y-auto pe-1"
          >
            {shownCues.map(([cue, i]) => {
              const isCurrent = current?.index === cue.index;
              return (
                <li
                  key={cue.index}
                  data-cue={cue.index}
                  className={`p-3 rounded-xl border text-sm transition-colors ${
                    isCurrent ? 'border-amber-400 bg-amber-950/20' : 'border-slate-800 bg-slate-950'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <button className="font-mono text-xs text-amber-400 hover:underline" onClick={() => seek(cue.start)}>
                      {timestamp(cue.start, '.').slice(0, 8)} – {timestamp(cue.end, '.').slice(0, 8)}
                    </button>
                    <button
                      aria-label={editing === cue.index ? t("Finish editing") : t("Edit line")}
                      onClick={() => setEditing(editing === cue.index ? null : cue.index)}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      {editing === cue.index ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className={`grid gap-2 ${view === 'both' ? 'md:grid-cols-2' : ''}`}>
                    {view !== 'translation' &&
                      (editing === cue.index ? (
                        // Correcting a misheard word teaches KAVOX's speech fixes.
                        <textarea
                          dir="auto"
                          aria-label={t("What was said")}
                          rows={2}
                          value={cue.text}
                          onChange={(e) => {
                            setCues(cues.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)));
                            setEdited(true);
                          }}
                          className="w-full p-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-300 focus:outline-none focus:border-amber-400/60"
                        />
                      ) : (
                        <p dir="auto" className="text-slate-400 leading-relaxed">{renderWords(cue, cue.text, false, view === 'original')}</p>
                      ))}
                    {view !== 'original' &&
                      (editing === cue.index ? (
                        <textarea
                          dir={dir}
                          aria-label={t("Translation")}
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
                        <p dir={dir} className="text-white font-medium leading-relaxed">{renderWords(cue, cue.translation, dir === 'rtl', true)}</p>
                      ))}
                  </div>
                </li>
              );
            })}
            {q && shownCues.length === 0 && <li className="text-sm text-slate-500 py-4 text-center">{t("No line contains “")}{query}”.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * 👍 / 👎 on the translation (and the voice of a dubbed video). A thumbs down asks for a
 * correction: corrections are what teach KAVOX; the ratings show the admin where it is needed.
 */
function Rating({ job, onCorrect }: { job: Job; onCorrect: () => void }) {
  const [ratings, setRatings] = useState(job.ratings ?? {});
  const [failed, setFailed] = useState(false);
  // One rating is saved at a time, so the last one pressed is the one kept.
  const [saving, setSaving] = useState(false);
  const aspects: { key: RatingAspect; label: string }[] = [
    { key: 'translation', label: t("Translation") },
    ...(job.mode === 'dub' ? [{ key: 'voice' as const, label: t("Voice") }] : []),
  ];
  const send = (aspect: RatingAspect, value: 1 | -1) => {
    if (saving) return;
    const before = ratings;
    setRatings({ ...ratings, [aspect]: value });
    setFailed(false);
    setSaving(true);
    api
      .rate(job.id, aspect, value)
      .then((r) => setRatings(r.ratings))
      .catch(() => {
        setRatings(before);
        setFailed(true);
      })
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
      {aspects.map(({ key, label }) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          {label}
          {([1, -1] as const).map((v) => (
            <button
              key={v}
              aria-label={`${label}: ${v === 1 ? t('good') : t('needs work')}`}
              aria-pressed={ratings[key] === v}
              disabled={saving}
              onClick={() => send(key, v)}
              className={`p-1.5 rounded-lg border ${ratings[key] === v ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-slate-700 text-slate-400 hover:text-white'}`}
            >
              {v === 1 ? <ThumbsUp className="w-4 h-4" /> : <ThumbsDown className="w-4 h-4" />}
            </button>
          ))}
        </span>
      ))}
      {ratings.translation === -1 && (
        <button onClick={onCorrect} className="text-xs text-amber-300 underline underline-offset-2">
          {t("Correct the lines below: your corrections teach KAVOX")}
        </button>
      )}
      {failed && <span className="text-xs text-red-400">{t("Your rating was not saved. Try again.")}</span>}
    </div>
  );
}
