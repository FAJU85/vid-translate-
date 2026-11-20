import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, Copy, Download, ExternalLink, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { adminApi, type AdminAction, type AdminJob } from '../../../shared/api';
import { Avatar } from './JobCard';
import { STATUS_STYLE, canDo, formatDuration, fullTime, jobTitle, ownerBadge } from './model';

const OUTPUT_LABEL: Record<string, string> = {
  mp4: 'Video with subtitles',
  srt: 'Subtitles (.srt)',
  vtt: 'Subtitles (.vtt)',
  original_srt: 'Original-language subtitles (.srt)',
  bilingual_srt: 'Both languages (.srt)',
  transcript: 'Transcript (.txt)',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 border-b border-slate-800/70 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-200 break-words">{children}</dd>
    </div>
  );
}

/**
 * Everything about one job, in a panel that slides over the right side so the board stays in view.
 * The card's secondary details live here.
 */
export function Drawer({ job, password, busy, run, onClose }: {
  job: AdminJob | null;
  password: string;
  busy: boolean;
  run: (action: AdminAction, ids: string[]) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminJob | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = job?.id;
  const status = job?.status;

  // Download links are signed on request, so the full record is fetched when the drawer opens.
  useEffect(() => {
    setDetail(null);
    if (!id) return;
    let live = true;
    adminApi.job(password, id).then((d) => live && setDetail(d), () => {});
    return () => {
      live = false;
    };
  }, [id, status, password]);

  useEffect(() => {
    if (id) panel.current?.focus();
  }, [id]);

  const open = !!job;
  const shown = job && detail?.id === job.id ? { ...detail, ...job, outputs: detail.outputs } : job;
  const tone = shown ? STATUS_STYLE[shown.status] : null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={shown ? `Job: ${jobTitle(shown)}` : 'Job details'}
        className={`fixed z-40 top-0 right-0 h-full w-full sm:w-[34rem] bg-slate-900 border-l border-slate-800 shadow-2xl shadow-black/60 flex flex-col outline-none transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {shown && tone && (
          <>
            <header className="flex items-start gap-3 p-5 border-b border-slate-800">
              <Avatar job={shown} size="md" />
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-white break-words">{jobTitle(shown)}</h2>
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${tone.soft} ${tone.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                    {shown.waking ? 'Waking the server' : tone.label}
                  </span>
                  <span className="text-slate-500">{ownerBadge(shown).label}</span>
                </div>
              </div>
              <button onClick={onClose} aria-label="Close (Esc)" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {(shown.status === 'running' || shown.status === 'queued') && (
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                    <span className="capitalize">{shown.stage.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums">{shown.progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-status-running transition-[width] duration-700" style={{ width: `${shown.progress}%` }} />
                  </div>
                </div>
              )}

              {shown.status === 'failed' && (
                <div className="p-3 rounded-lg border border-status-failed/40 bg-status-failed/10 text-sm text-rose-100">
                  <div className="font-mono text-xs text-status-failed">{shown.error_code}</div>
                  {shown.error_message && <p className="mt-1 break-words">{shown.error_message}</p>}
                </div>
              )}

              {shown.status === 'done' && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Files</h3>
                  {!detail ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                  ) : Object.keys(shown.outputs).length ? (
                    <div className="grid gap-2">
                      {Object.entries(shown.outputs).map(([key, url]) => (
                        <a
                          key={key}
                          href={url}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800"
                        >
                          <Download className="w-4 h-4 text-status-done" />
                          {OUTPUT_LABEL[key] ?? key}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">The files have expired (they are kept for 24 hours).</p>
                  )}
                </section>
              )}

              <dl>
                <Row label="Source">
                  {shown.source_kind === 'url' && shown.source ? (
                    <a href={shown.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-300 hover:underline break-all">
                      {shown.source} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (shown.source_kind as string) === 'rerender' ? (
                    `Edited subtitles, rendered into the video of job ${shown.source}`
                  ) : shown.source_kind === 'upload' ? (
                    `Uploaded file: ${shown.source}`
                  ) : (
                    'File sent to the Telegram bot'
                  )}
                </Row>
                <Row label="Channel">{shown.channel === 'telegram' ? 'Telegram bot' : 'Website'}</Row>
                <Row label="Languages">
                  <span className="uppercase">{shown.detected_lang ?? shown.src_lang}</span> → <span className="uppercase">{shown.tgt_lang}</span>
                  {shown.src_lang === 'auto' && shown.detected_lang && <span className="text-slate-500"> (detected)</span>}
                </Row>
                <Row label="Output">{shown.mode === 'hard' ? 'Video with burned-in subtitles' : 'Subtitle files'}</Row>
                {shown.mode === 'hard' && (
                  <Row label="Subtitle style">
                    {shown.style ? (
                      <span className="inline-flex items-center gap-2 capitalize">
                        <span className="w-3 h-3 rounded-full border border-slate-600" style={{ background: shown.style.color }} />
                        {shown.style.font ?? 'modern'} font, {shown.style.size === 'xlarge' ? 'extra large' : shown.style.size}, {shown.style.position},{' '}
                        {shown.style.background === 'box' ? 'dark box' : 'outline'}
                      </span>
                    ) : (
                      'Default'
                    )}
                  </Row>
                )}
                <Row label="Video length">{formatDuration(shown.duration)}</Row>
                <Row label="Created">{fullTime(shown.created_at)}</Row>
                <Row label="Last update">{fullTime(shown.updated_at)}</Row>
                {shown.dispatch_attempts > 0 && <Row label="Hand-off tries">{shown.dispatch_attempts}</Row>}
                <Row label="Job id">
                  <button
                    onClick={() => navigator.clipboard?.writeText(shown.id)}
                    className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400 hover:text-white"
                    title="Copy"
                  >
                    {shown.id} <Copy className="w-3 h-3" />
                  </button>
                </Row>
              </dl>
            </div>

            <footer className="flex flex-wrap items-center gap-2 p-4 border-t border-slate-800">
              {canDo('cancel', shown) && (
                <button disabled={busy} onClick={() => run('cancel', [shown.id])} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
                  <Ban className="w-4 h-4" /> Cancel <kbd className="text-[10px] text-slate-500">C</kbd>
                </button>
              )}
              {canDo('retry', shown) && (
                <button disabled={busy} onClick={() => run('retry', [shown.id])} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400 text-sm font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-50">
                  <RotateCcw className="w-4 h-4" /> Retry <kbd className="text-[10px] opacity-60">R</kbd>
                </button>
              )}
              {canDo('delete', shown) && (
                <button
                  disabled={busy}
                  onClick={() => confirm('Delete this job? Its files stay on the server until they expire.') && run('delete', [shown.id])}
                  className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-rose-300 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
              {shown.source_kind === 'upload' && (shown.status === 'failed' || shown.status === 'cancelled') && (
                <p className="w-full text-xs text-slate-500">Uploaded files are not kept, so this job cannot be retried.</p>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
