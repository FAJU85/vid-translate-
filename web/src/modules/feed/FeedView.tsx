import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Flag, Heart, Link2, Loader2, MessageCircle, Plus, Search, Volume2, VolumeX } from 'lucide-react';
import { ApiError, socialApi, type AppConfig, type FeedItem, type FeedTab, type ReportKind } from '../../shared/api';
import { CommentsSheet, ReportSheet } from './Sheets';
import { Discover, TagText } from './Discover';

/** One video, full height: it plays while on screen, with its creator and actions on top. */
function FeedCard({ item, muted, onMute, lang, onChange, onSignIn, signedIn, onTag }: {
  item: FeedItem;
  muted: boolean;
  onMute: () => void;
  lang: (code: string | null) => string;
  onChange: (patch: Partial<FeedItem>) => void;
  onSignIn: () => void;
  signedIn: boolean;
  onTag: (tag: string) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'like' | 'follow' | null>(null);
  // What is open over the bottom of the card: its comments, or a report (of the video or a comment).
  const [sheet, setSheet] = useState<'comments' | { kind: ReportKind; target: string } | null>(null);

  // Plays while most of it is on screen; pauses (and saves data) otherwise.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        const v = video.current;
        if (!v) return;
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.6 },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  async function like() {
    if (!signedIn) return onSignIn();
    const next = !item.liked;
    onChange({ liked: next, likes: item.likes + (next ? 1 : -1) }); // shown at once, corrected by the answer
    setBusy('like');
    try {
      onChange(await socialApi.like(item.id, next));
    } catch {
      onChange({ liked: item.liked, likes: item.likes });
    } finally {
      setBusy(null);
    }
  }
  async function follow() {
    if (!signedIn) return onSignIn();
    setBusy('follow');
    try {
      const r = await socialApi.follow(item.creator.handle, !item.following);
      onChange({ following: r.following });
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: item.title ?? 'KAVOX', url: item.url });
      else {
        await navigator.clipboard.writeText(item.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* closed the share sheet */
    }
  }

  const from = item.src_lang && item.src_lang !== 'auto' && item.src_lang !== item.tgt_lang ? `${lang(item.src_lang)} → ` : '';
  const action = 'flex flex-col items-center gap-0.5 text-[11px] font-semibold text-white drop-shadow';
  const round = 'w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center';
  return (
    <div ref={box} className="relative h-full w-full snap-start snap-always bg-black overflow-hidden">
      <video
        ref={video}
        src={item.video_url}
        poster={item.thumb_url ?? undefined}
        loop
        playsInline
        muted={muted}
        preload="metadata"
        onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())}
        className="absolute inset-0 w-full h-full object-contain"
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
      <div className="absolute left-3 right-20 bottom-4 text-white space-y-1">
        <a href={`/@${item.creator.handle}`} className="font-bold drop-shadow hover:underline">
          @{item.creator.handle}
        </a>
        {item.title && (
          <p className="text-sm leading-snug line-clamp-2 drop-shadow pointer-events-auto">
            <TagText text={item.title} onTag={onTag} />
          </p>
        )}
        <p className="text-xs text-slate-200 drop-shadow">
          {item.mode === 'dub' ? 'Dubbed' : 'Subtitled'} · {from}
          {lang(item.tgt_lang)}
        </p>
      </div>
      <div className="absolute right-2 bottom-6 flex flex-col items-center gap-4">
        {!item.mine && (
          <button onClick={follow} disabled={busy === 'follow'} aria-label={item.following ? `Unfollow @${item.creator.handle}` : `Follow @${item.creator.handle}`} className={action}>
            <span className={`${round} ${item.following ? '' : 'bg-amber-400/90 text-slate-950'}`}>
              {busy === 'follow' ? <Loader2 className="w-5 h-5 animate-spin" /> : item.following ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            </span>
            {item.following ? 'Following' : 'Follow'}
          </button>
        )}
        <button onClick={like} disabled={busy === 'like'} aria-pressed={item.liked} aria-label="Like" className={action}>
          <span className={round}>
            <Heart className={`w-6 h-6 ${item.liked ? 'fill-rose-500 text-rose-500' : ''}`} />
          </span>
          {item.likes}
        </button>
        <button onClick={() => setSheet('comments')} aria-label="Comments" className={action}>
          <span className={round}>
            <MessageCircle className="w-6 h-6" />
          </span>
          {item.comments}
        </button>
        <button onClick={share} aria-label="Share" className={action}>
          <span className={round}>{copied ? <Check className="w-5 h-5" /> : <Link2 className="w-5 h-5" />}</span>
          {copied ? 'Copied' : 'Share'}
        </button>
        <button onClick={onMute} aria-label={muted ? 'Sound on' : 'Sound off'} className={action}>
          <span className={round}>{muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}</span>
        </button>
        {!item.mine && (
          <button onClick={() => setSheet({ kind: 'video', target: item.id })} aria-label="Report" className={action}>
            <span className={round}>
              <Flag className="w-4 h-4" />
            </span>
          </button>
        )}
      </div>
      {sheet === 'comments' && (
        <CommentsSheet
          videoId={item.id}
          signedIn={signedIn}
          onSignIn={onSignIn}
          onClose={() => setSheet(null)}
          onCount={(d) => onChange({ comments: Math.max(0, item.comments + d) })}
          onReport={(id) => setSheet({ kind: 'comment', target: String(id) })}
        />
      )}
      {sheet && sheet !== 'comments' && <ReportSheet kind={sheet.kind} target={sheet.target} onClose={() => setSheet(null)} />}
    </div>
  );
}

/**
 * The feed: posted videos one screen at a time, "For you" (ranked by likes, views and freshness)
 * or "Following" (newest from the creators you follow). More load as you scroll.
 */
export function FeedView({ config, signedIn, onSignIn }: { config: AppConfig | null; signedIn: boolean; onSignIn: () => void }) {
  const [tab, setTab] = useState<FeedTab>('foryou');
  // A hashtag link (/?tab=feed&tag=cats, from a video page) opens Discover on that hashtag.
  const [tag, setTag] = useState<string | null>(() => new URLSearchParams(window.location.search).get('tag'));
  const [discover, setDiscover] = useState(Boolean(tag));
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('tag')) return;
    url.searchParams.delete('tag');
    window.history.replaceState(null, '', url);
  }, []);
  const openTag = useCallback((t: string | null) => {
    setTag(t);
    if (t) setDiscover(true);
  }, []);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // Browsers only start videos with sound after a tap: start muted, one tap turns sound on for all.
  const [muted, setMuted] = useState(true);
  const request = useRef(0);
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    (cursor: string | null, reset: boolean) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      socialApi
        .feed(tab, cursor)
        .then((r) => {
          if (id !== request.current) return;
          setNeedsSignIn(Boolean(r.sign_in));
          setItems((prev) => {
            const seen = new Set(reset ? [] : prev.map((i) => i.id));
            return [...(reset ? [] : prev), ...r.items.filter((i) => !seen.has(i.id))];
          });
          setNext(r.next);
          setDone(!r.next);
        })
        .catch((err) => id === request.current && setError(err instanceof ApiError ? err.message : 'The feed could not be loaded.'))
        .finally(() => id === request.current && setLoading(false));
    },
    [tab],
  );
  useEffect(() => {
    setItems([]);
    setNext(null);
    setDone(false);
    load(null, true);
  }, [load, signedIn]);

  // Near the end: the next page.
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const near = new IntersectionObserver(([e]) => e.isIntersecting && !loading && !done && next && load(next, false), { rootMargin: '600px' });
    near.observe(el);
    return () => near.disconnect();
  }, [load, loading, done, next]);

  const lang = (code: string | null) => (code && config?.languages.find((l) => l.code === code)?.en) || code || '';
  const patch = (id: string) => (p: Partial<FeedItem>) =>
    setItems((list) =>
      list.map((i) => {
        if (i.id === id) return { ...i, ...p };
        // Following a creator follows them on every card of theirs.
        const changed = list.find((x) => x.id === id);
        return 'following' in p && changed && i.creator.handle === changed.creator.handle ? { ...i, following: p.following! } : i;
      }),
    );

  return (
    <div className="-mx-4 -my-8 sm:mx-0 sm:my-0">
      <div className="flex justify-center gap-1 py-2 text-sm">
        {(['foryou', 'following'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setDiscover(false);
            }}
            aria-pressed={!discover && tab === t}
            className={`px-3 py-1.5 rounded-lg ${!discover && tab === t ? 'bg-slate-100 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            {t === 'foryou' ? 'For you' : 'Following'}
          </button>
        ))}
        <button
          onClick={() => setDiscover(true)}
          aria-pressed={discover}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg ${discover ? 'bg-slate-100 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'}`}
        >
          <Search className="w-3.5 h-3.5" /> Discover
        </button>
      </div>
      {discover && <Discover tag={tag} onTag={openTag} />}
      <div className={`${discover ? 'hidden' : ''} mx-auto w-full sm:max-w-md h-[calc(100dvh-8.5rem)] overflow-y-auto snap-y snap-mandatory [overflow-anchor:none] sm:rounded-2xl bg-black`}>
        {items.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            muted={muted}
            onMute={() => setMuted((m) => !m)}
            lang={lang}
            onChange={patch(item.id)}
            onSignIn={onSignIn}
            signedIn={signedIn}
            onTag={openTag}
          />
        ))}
        {/* Not a snap point: the scroll would stay pinned to it as videos load above it (jumping to the end). */}
        <div ref={end} className="min-h-[30%] flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-400">
          {loading && <Loader2 className="w-6 h-6 animate-spin" />}
          {error && (
            <>
              <span className="text-rose-300">{error}</span>
              <button onClick={() => load(next, items.length === 0)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200">
                Try again
              </button>
            </>
          )}
          {!loading && !error && needsSignIn && (
            <>
              Sign in to see videos from the creators you follow.
              <button onClick={onSignIn} className="px-3 py-1.5 rounded-lg bg-amber-400 font-semibold text-slate-950">
                Sign in
              </button>
            </>
          )}
          {!loading && !error && !needsSignIn && done && (items.length
            ? "You're all caught up."
            : tab === 'following'
              ? 'No videos yet from the creators you follow. Find some in "For you".'
              : 'No videos posted yet. Translate one and post it to your profile from the Dashboard.')}
        </div>
      </div>
    </div>
  );
}
