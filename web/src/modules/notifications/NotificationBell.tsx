import { useEffect, useRef, useState } from 'react';
import { Bell, Heart, Loader2, MessageCircle, Send, UserPlus, Video, X } from 'lucide-react';
import { ApiError, notificationsApi, type Inbox, type Notification } from '../../shared/api';

/** How often the bell asks for the unread count while the page is open. */
const POLL_MS = 60_000;

function ago(sec: number): string {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return 'now';
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d`;
  return new Date(sec * 1000).toLocaleDateString();
}

const ICON = { follow: UserPlus, like: Heart, comment: MessageCircle, post: Video } as const;
const TONE = { follow: 'text-sky-300', like: 'text-rose-400', comment: 'text-amber-300', post: 'text-emerald-300' } as const;

function Row({ n, isNew }: { n: Notification; isNew: boolean }) {
  const Icon = ICON[n.kind];
  const what =
    n.kind === 'follow' ? 'started following you' : n.kind === 'like' ? 'liked your video' : n.kind === 'comment' ? 'commented' : 'posted a new video';
  const href = n.kind === 'follow' ? `/@${n.actor.handle}` : (n.video?.url ?? `/@${n.actor.handle}`);
  return (
    <li>
      <a href={href} className={`flex gap-3 px-4 py-3 hover:bg-slate-800/70 ${isNew ? 'bg-amber-400/5' : ''}`}>
        <span className={`mt-0.5 shrink-0 ${TONE[n.kind]}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="text-slate-200">
            <b className="text-white">@{n.actor.handle}</b> {what}
            {n.video?.title && n.kind !== 'follow' ? <>: <span className="text-slate-300">{n.video.title}</span></> : null}
          </span>
          {n.text && <span className="block mt-0.5 text-slate-400 line-clamp-2 break-words">“{n.text}”</span>}
          <span className="block mt-0.5 text-xs text-slate-500">{ago(n.created_at)}</span>
        </span>
        {n.video?.thumb && <img src={n.video.thumb} alt="" className="w-9 h-14 rounded object-cover bg-slate-950 shrink-0" />}
        {isNew && <span className="mt-1.5 w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-label="new" />}
      </a>
    </li>
  );
}

/**
 * The bell in the header (signed in only): the unread count, and on a tap the inbox (new followers,
 * likes, comments, new videos from creators you follow). Opening it marks everything as seen.
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  // The count: now, every minute while the tab is visible, and when the tab comes back.
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      notificationsApi
        .unread()
        .then((r) => alive && setUnread(r.count))
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function load(before: string | null) {
    setLoading(true);
    setError(null);
    notificationsApi
      .list(before)
      .then((r) => {
        setInbox((prev) => (before && prev ? { ...r, seen_id: prev.seen_id, items: [...prev.items, ...r.items] } : r));
        if (!before && r.unread) notificationsApi.read().then(() => setUnread(0)).catch(() => {});
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Your notifications could not be loaded.'))
      .finally(() => setLoading(false));
  }
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load(null);
  }
  async function telegram(on: boolean) {
    setTgBusy(true);
    try {
      const r = await notificationsApi.telegram(on);
      setInbox((prev) => (prev ? { ...prev, telegram: r.telegram } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setTgBusy(false);
    }
  }

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
        className="relative flex items-center px-2 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-[10px] font-bold leading-[1.1rem] text-white text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 max-h-[75vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/50 z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="font-semibold text-white text-sm">Notifications</span>
            <button onClick={() => setOpen(false)} aria-label="Close notifications" className="p-1 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
            {inbox?.items.map((n) => <Row key={n.id} n={n} isNew={n.id > inbox.seen_id} />)}
            {!loading && !error && inbox && inbox.items.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-slate-400">
                Nothing yet. New followers, likes and comments on your videos, and new videos from creators you follow, show here.
              </li>
            )}
            {loading && (
              <li className="py-4 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </li>
            )}
            {!loading && inbox?.next && (
              <li className="py-2 text-center">
                <button onClick={() => load(inbox.next)} className="text-xs text-slate-300 hover:text-white">
                  Older
                </button>
              </li>
            )}
          </ul>
          {error && <p className="px-4 py-2 text-xs text-rose-300">{error}</p>}
          {inbox && (
            <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
              {inbox.telegram.linked ? (
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-sky-400" /> Also send them to me on Telegram
                  </span>
                  <input type="checkbox" checked={inbox.telegram.on} disabled={tgBusy} onChange={(e) => telegram(e.target.checked)} className="accent-amber-400 w-4 h-4" />
                </label>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-sky-400" /> Telegram messages need an account that signs in with Telegram.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
