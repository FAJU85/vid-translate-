import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Coins, Copy, ExternalLink, Eye, Film, Globe2, Loader2, Pencil, Play, RefreshCw, Trash2, Video } from 'lucide-react';
import { ApiError, accountApi, dashboardApi, type AppConfig, type Dashboard, type DashboardVideo, type Me } from '../../shared/api';
import { BUCKET_LABEL, OutroSettings, creditsText } from '../account';
import { DayBars } from './DayBars';
import { ProfileCard } from './ProfileCard';
import { AnalyticsCard } from './AnalyticsCard';

const MODE_LABEL: Record<string, string> = { soft: 'Subtitle files', hard: 'Burned-in subtitles', dub: 'Dubbed' };

function minutes(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = seconds / 60;
  return m < 100 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}

function Stat({ icon: Icon, label, value, note }: { icon: typeof Video; label: string; value: string; note?: string }) {
  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-white tabular-nums">{value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  );
}

/** One translated video: its picture, what it is, its link and what can be done with it. */
function VideoCard({ v, lang, onOpen, onDeleted, signedIn }: {
  v: DashboardVideo;
  lang: (code: string | null) => string;
  onOpen: (jobId: string) => void;
  onDeleted: () => void;
  signedIn: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const share = v.share;
  const [visibility, setVisibility] = useState(share?.visibility ?? 'link');
  // A refresh (or another tab) may have changed it: the latest data wins.
  useEffect(() => setVisibility(share?.visibility ?? 'link'), [share?.id, share?.visibility]);
  const [posting, setPosting] = useState(false);
  // The caption (#hashtags in it make the video findable in Discover).
  const [caption, setCaption] = useState<string | null>(share?.title ?? v.title);
  useEffect(() => setCaption(share?.title ?? v.title), [share?.id, share?.title, v.title]);
  const [editing, setEditing] = useState<string | null>(null);
  async function saveCaption() {
    if (!share || editing === null) return;
    setPosting(true);
    try {
      setCaption((await dashboardApi.setTitle(share.id, editing)).title);
      setEditing(null);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'The caption could not be saved.');
    } finally {
      setPosting(false);
    }
  }
  /** Post the video to your profile, or take it back to "only people with the link". */
  async function togglePost() {
    if (!share) return;
    const next = visibility === 'public' ? 'link' : 'public';
    setPosting(true);
    try {
      setVisibility((await dashboardApi.setVisibility(share.id, next)).visibility);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setPosting(false);
    }
  }
  async function copy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link', share.url);
    }
  }
  async function remove() {
    if (!share || !window.confirm('Delete this link? The video page stops working for everyone.')) return;
    setBusy(true);
    try {
      await dashboardApi.deleteShare(share.id);
      onDeleted();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'The link could not be deleted.');
    } finally {
      setBusy(false);
    }
  }
  const from = v.src_lang && v.src_lang !== 'auto' && v.src_lang !== v.tgt_lang ? `${lang(v.src_lang)} → ` : '';
  const failed = v.status === 'failed' || v.status === 'cancelled';
  return (
    <li className="flex gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900">
      <div className="relative w-28 sm:w-36 aspect-video shrink-0 rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center">
        {share?.thumb_url ? (
          <img src={share.thumb_url} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <Film className="w-6 h-6 text-slate-700" />
        )}
        {share && (
          <a href={share.url} target="_blank" rel="noreferrer" aria-label="Watch" className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/40 group">
            <Play className="w-7 h-7 text-white opacity-0 group-hover:opacity-100" />
          </a>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {editing === null ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-white truncate">{caption || 'Untitled video'}</span>
            {share && (
              <button onClick={() => setEditing(caption ?? '')} aria-label="Edit caption" title="Edit the caption (add #hashtags)" className="shrink-0 text-slate-500 hover:text-white">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveCaption();
            }}
            className="flex gap-1.5"
          >
            <input
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              maxLength={150}
              placeholder="Caption, e.g. Funny cat #cats #arabic"
              className="min-w-0 flex-1 px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-400/60"
            />
            <button disabled={posting} className="px-2 rounded-md bg-amber-400 text-xs font-semibold text-slate-950 disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)} className="px-1.5 text-xs text-slate-400 hover:text-white">
              Cancel
            </button>
          </form>
        )}
        <div className="text-xs text-slate-400 flex flex-wrap gap-x-2">
          <span>{new Date(v.created_at * 1000).toLocaleDateString()}</span>
          <span>{MODE_LABEL[v.mode] ?? v.mode}{v.rerender ? ' (edited)' : ''}</span>
          <span>{from}{lang(v.tgt_lang)}</span>
          {v.duration ? <span>{minutes(v.duration)}</span> : null}
          {v.channel === 'telegram' && (
            <span className="inline-flex items-center gap-0.5">
              <Bot className="w-3 h-3" /> bot
            </span>
          )}
          {failed && <span className="text-rose-300">{v.status === 'failed' ? 'Failed' : 'Cancelled'}</span>}
          {!failed && v.status !== 'done' && <span className="text-amber-300">In progress</span>}
        </div>
        {share && (
          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2">
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3 h-3" /> {share.views} view{share.views === 1 ? '' : 's'}
            </span>
            <span>{share.expires_at ? `link until ${new Date(share.expires_at * 1000).toLocaleDateString()}` : 'link kept'}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {share && (
            <>
              <button onClick={copy} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-400 hover:bg-amber-300 text-xs font-semibold text-slate-950">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}
              </button>
              <a href={share.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:bg-slate-800">
                <ExternalLink className="w-3.5 h-3.5" /> Page
              </a>
            </>
          )}
          {share && signedIn && (
            <button
              onClick={togglePost}
              disabled={posting}
              aria-pressed={visibility === 'public'}
              title={visibility === 'public' ? 'On your profile: tap to show it to people with the link only' : 'Only people with the link see it: tap to post it to your profile'}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs disabled:opacity-50 ${visibility === 'public' ? 'border-amber-400 bg-amber-400/15 text-amber-300' : 'border-slate-700 text-slate-200 hover:bg-slate-800'}`}
            >
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe2 className="w-3.5 h-3.5" />} {visibility === 'public' ? 'On profile' : 'Post to profile'}
            </button>
          )}
          {v.can_open && (
            <button onClick={() => onOpen(v.job_id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:bg-slate-800">
              Files and editor
            </button>
          )}
          {share && (
            <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-rose-300 disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete link
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Your account at a glance: balance, numbers, the ending of your videos, and every video you translated. */
type Section = 'videos' | 'analytics' | 'profile';
const SECTIONS: readonly [Section, string][] = [
  ['videos', 'Videos'],
  ['analytics', 'Analytics'],
  ['profile', 'Profile'],
];

export function DashboardView({ me, config, onMe, onOpenJob, onSignIn, onPricing, onTranslate }: {
  me: Me | null;
  config: AppConfig | null;
  onMe: (me: Me) => void;
  onOpenJob: (jobId: string) => void;
  onSignIn: () => void;
  onPricing: () => void;
  /** Opens the Translate page (from the empty list). */
  onTranslate?: () => void;
}) {
  // One part at a time, the videos first (what creators come back for most).
  const [section, setSection] = useState<Section>('videos');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the latest request may show its answer (an older one can arrive after signing in or out).
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    setLoading(true);
    dashboardApi
      .get()
      .then((d) => {
        if (id === request.current) (setData(d), setError(null));
      })
      .catch((err) => {
        if (id === request.current) setError(err instanceof ApiError ? err.message : 'The dashboard could not be loaded.');
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  }, []);
  useEffect(() => {
    setData(null); // another person's videos never stay on screen
    load();
  }, [load, me?.account?.id]);
  /** Refresh: the videos and numbers, and the balance (credits may have been used in the bot). */
  const refresh = () => {
    load();
    accountApi.me().then(onMe, () => {});
  };

  const lang = (code: string | null) => (code && config?.languages.find((l) => l.code === code)?.en) || code || '';
  const s = data?.stats;
  const balance = me?.credits_enabled ? me.balance : null;
  const plan = balance?.buckets.find((b) => b.bucket === 'monthly' && b.expires_at);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400">
            {me?.account ? `Signed in as ${me.account.name || me.account.email || 'you'}: videos from the website and the Telegram bot.` : 'Videos translated in this browser.'}
          </p>
        </div>
        <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </section>

      {!me?.account && me?.sign_in && (me.sign_in.telegram || me.sign_in.google || me.sign_in.email) && (
        <div className="p-4 rounded-xl border border-amber-400/40 bg-amber-400/5 flex flex-wrap items-center justify-between gap-3 text-sm text-amber-100">
          Sign in to see your videos from every device and the Telegram bot in one place, and keep your credits.
          <button onClick={onSignIn} className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 font-semibold text-slate-950">
            Sign in
          </button>
        </div>
      )}

      {error && <p className="p-3 rounded-lg border border-rose-800 bg-rose-950/60 text-sm text-rose-200">{error}</p>}


      {balance && (
        <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Coins className="w-3.5 h-3.5 text-amber-400" /> Balance
            </div>
            <div className="text-3xl font-bold text-white tabular-nums">{creditsText(balance.total_seconds)} credits</div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
              {balance.buckets
                .filter((b) => b.seconds > 0)
                .map((b) => (
                  <span key={b.bucket}>
                    {BUCKET_LABEL[b.bucket]}: {creditsText(b.seconds)}
                  </span>
                ))}
              {plan?.expires_at && <span>Plan renews or ends {new Date(plan.expires_at * 1000).toLocaleDateString()}</span>}
            </div>
          </div>
          <button onClick={onPricing} className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-sm font-semibold text-slate-950">
            Get more credits
          </button>
        </section>
      )}

      {/* The three parts of the dashboard, one at a time. */}
      {me?.account && (
        <div role="tablist" aria-label="Dashboard" className="sticky top-[61px] z-30 -mx-4 px-4 py-2 bg-slate-950/90 backdrop-blur-xl flex gap-1 text-sm">
          {SECTIONS.map(([id, label], i) => (
            <button
              key={id}
              id={`dash-tab-${id}`}
              role="tab"
              aria-selected={section === id}
              aria-controls={`dash-panel-${id}`}
              // One Tab stop for the row; the arrow keys move between tabs (and wrap around).
              tabIndex={section === id ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
                e.preventDefault();
                const n = SECTIONS.length;
                const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
                setSection(SECTIONS[to][0]);
                document.getElementById(`dash-tab-${SECTIONS[to][0]}`)?.focus();
              }}
              onClick={() => setSection(id)}
              className={`px-4 py-1.5 rounded-full ${section === id ? 'bg-slate-100 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Every panel stays on the page and the inactive ones are hidden, so nothing is lost on a switch. */}
      <div
        className="space-y-6"
        {...(me?.account ? { role: 'tabpanel', id: 'dash-panel-videos', 'aria-labelledby': 'dash-tab-videos', hidden: section !== 'videos' } : {})}
      >
      {/* Signed in: the numbers are in Analytics; here, one line. */}
      {s && me?.account && (
        <p className="text-sm text-slate-400">
          <b className="text-slate-100">{s.videos}</b> video{s.videos === 1 ? '' : 's'} translated · <b className="text-slate-100">{s.share_views}</b> view
          {s.share_views === 1 ? '' : 's'} of your links ·{' '}
          <button onClick={() => setSection('analytics')} className="text-amber-300 hover:underline">
            See analytics
          </button>
        </p>
      )}
      {!me?.account &&
        s && (
        <section className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={Video} label="Videos translated" value={String(s.videos)} note={`${s.last_30_days.videos} in the last 30 days`} />
            <Stat icon={Film} label="Minutes translated" value={minutes(s.seconds)} note={`${minutes(s.last_30_days.seconds)} in the last 30 days`} />
            <Stat icon={Eye} label="Views of your links" value={String(s.share_views)} note={`${s.shared_videos} shared video${s.shared_videos === 1 ? '' : 's'}`} />
            <Stat
              icon={Globe2}
              label="Top language"
              value={s.languages[0] ? lang(s.languages[0].lang) : '—'}
              note={s.languages.length > 1 ? s.languages.slice(1, 4).map((l) => lang(l.lang)).join(', ') : undefined}
            />
          </div>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Your videos</h2>
        {!data && !error && <Loader2 className="w-5 h-5 animate-spin text-slate-500" />}
        {data && data.videos.length === 0 && (
          <div className="p-8 rounded-2xl border border-dashed border-slate-700 text-center space-y-3">
            <p className="text-sm text-slate-300">Nothing yet. Translate a video and it shows up here, with its link.</p>
            {onTranslate && (
              <button onClick={onTranslate} className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-sm font-semibold text-slate-950">
                Translate your first video
              </button>
            )}
          </div>
        )}
        <ul className="space-y-2">
          {data?.videos.map((v) => (
            <VideoCard key={v.job_id} v={v} lang={lang} onOpen={onOpenJob} onDeleted={load} signedIn={Boolean(me?.account)} />
          ))}
        </ul>
        {data && data.videos.length > 0 && (
          <p className="text-xs text-slate-500">
            Files and the subtitle editor stay available for 24 hours; video pages last 30 days on the free plan, and as long as you
            keep them with a monthly plan.
          </p>
        )}
      </section>
      </div>

      {me?.account && (
        <div role="tabpanel" id="dash-panel-analytics" aria-labelledby="dash-tab-analytics" hidden={section !== 'analytics'} className="space-y-6">
          <AnalyticsCard key={`a-${me.account.id}`} />
          {s && (
        <section className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={Video} label="Videos translated" value={String(s.videos)} note={`${s.last_30_days.videos} in the last 30 days`} />
            <Stat icon={Film} label="Minutes translated" value={minutes(s.seconds)} note={`${minutes(s.last_30_days.seconds)} in the last 30 days`} />
            <Stat icon={Eye} label="Views of your links" value={String(s.share_views)} note={`${s.shared_videos} shared video${s.shared_videos === 1 ? '' : 's'}`} />
            <Stat
              icon={Globe2}
              label="Top language"
              value={s.languages[0] ? lang(s.languages[0].lang) : '—'}
              note={s.languages.length > 1 ? s.languages.slice(1, 4).map((l) => lang(l.lang)).join(', ') : undefined}
            />
          </div>
        </section>
      )}
      {s && (
        <section className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2 p-4 rounded-xl border border-slate-800 bg-slate-900">
              <DayBars days={s.per_day} />
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 text-sm space-y-1.5">
              <div className="text-xs text-slate-400">By kind</div>
              {(['soft', 'hard', 'dub'] as const).map((m) => (
                <div key={m} className="flex justify-between">
                  <span className="text-slate-300">{MODE_LABEL[m]}</span>
                  <span className="tabular-nums text-white">{s.by_mode[m] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

        </div>
      )}

      {me?.account && (
        <div role="tabpanel" id="dash-panel-profile" aria-labelledby="dash-tab-profile" hidden={section !== 'profile'} className="space-y-6">
          <ProfileCard key={me.account.id} />
      {me?.outro && (
        <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900">
          <OutroSettings outro={me.outro} onChange={() => accountApi.me().then(onMe, () => {})} />
        </section>
      )}

        </div>
      )}
    </div>
  );
}
