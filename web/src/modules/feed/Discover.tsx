import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Flame, Hash, Heart, Loader2, Play, Search, Users, X } from 'lucide-react';
import { ApiError, discoverApi, type CreatorHit, type FeedItem } from '../../shared/api';

const TAG = /#([\p{L}\p{N}_]{1,50})/gu;

/** A caption with its #hashtags as buttons (each opens that hashtag in Discover). */
export function TagText({ text, onTag, className = '' }: { text: string; onTag: (tag: string) => void; className?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    parts.push(text.slice(last, m.index));
    const tag = m[1].toLowerCase();
    parts.push(
      <button
        key={m.index}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTag(tag);
        }}
        className={`font-semibold hover:underline ${className}`}
      >
        {m[0]}
      </button>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts.map((p, i) => (typeof p === 'string' ? <Fragment key={`t${i}`}>{p}</Fragment> : p))}</>;
}

/** Videos as a grid of tall tiles: the picture, the views or likes, and the caption. */
function Grid({ videos, badge }: { videos: (FeedItem & { week_likes?: number })[]; badge?: 'week' }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {videos.map((v) => (
        <a key={v.id} href={v.url} className="relative aspect-[9/16] rounded-lg overflow-hidden bg-slate-900 block group">
          {v.thumb_url ? (
            <img src={v.thumb_url} alt="" loading="lazy" className="w-full h-full object-cover" />
          ) : (
            // No picture: a soft brand gradient with a play mark (the caption is shown below).
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-400/20 via-slate-900 to-rose-400/15">
              <Play className="w-8 h-8 p-2 rounded-full bg-slate-100/10 text-slate-100" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/85 to-transparent text-[11px] text-white">
            <div dir="auto" className="line-clamp-2 leading-tight">{v.title || 'Untitled'}</div>
            <div className="mt-0.5 flex items-center gap-1 text-slate-300">
              <Heart className="w-3 h-3" /> {badge === 'week' ? `${v.week_likes ?? 0} this week` : v.likes} · @{v.creator.handle}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function Creators({ creators }: { creators: CreatorHit[] }) {
  return (
    <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
      {creators.map((c) => (
        <li key={c.handle}>
          <a href={`/@${c.handle}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/60">
            <span className="w-9 h-9 rounded-full bg-amber-400 text-slate-950 font-bold flex items-center justify-center shrink-0">{c.handle[0].toUpperCase()}</span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="block text-white font-medium truncate">{c.display_name || `@${c.handle}`}</span>
              <span className="block text-xs text-slate-400 truncate">
                @{c.handle} · {c.followers} follower{c.followers === 1 ? '' : 's'}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const heading = 'flex items-center gap-1.5 text-sm font-semibold text-slate-200';

/**
 * Discover: search creators (@handle or name) and videos (caption), open a #hashtag, and see what
 * is trending (the most liked videos this week, the hashtags used most lately).
 */
export function Discover({ tag, onTag }: { tag: string | null; onTag: (tag: string | null) => void }) {
  const [q, setQ] = useState('');
  const [trending, setTrending] = useState<Awaited<ReturnType<typeof discoverApi.trending>> | null>(null);
  const [results, setResults] = useState<{ creators: CreatorHit[]; videos: FeedItem[] } | null>(null);
  const [tagged, setTagged] = useState<FeedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    discoverApi.trending().then(setTrending).catch(() => setError('Trending could not be loaded.'));
  }, []);

  // A hashtag: its videos.
  useEffect(() => {
    setTagged(null);
    if (!tag) return;
    let current = true;
    setLoading(true);
    discoverApi
      .tag(tag)
      .then((r) => current && setTagged(r.items))
      .catch((err) => current && setError(err instanceof ApiError ? err.message : 'That hashtag could not be loaded.'))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [tag]);

  // Search: asked once typing stops; only the latest answer is shown. "#tag" opens the hashtag.
  const wanted = q.trim();
  useEffect(() => {
    setResults(null);
    setError(null);
    if (!wanted) return;
    if (/^#[\p{L}\p{N}_]+$/u.test(wanted)) {
      const timer = setTimeout(() => onTag(wanted.slice(1).toLowerCase()), 400);
      return () => clearTimeout(timer);
    }
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      discoverApi
        .search(wanted)
        .then((r) => current && setResults({ creators: r.creators, videos: r.videos }))
        .catch(() => current && setError('The search did not work. Try again.'))
        .finally(() => current && setLoading(false));
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted, onTag]);

  const searching = Boolean(wanted) && !tag;
  return (
    <div className="mx-auto w-full sm:max-w-md px-3 py-3 space-y-5 min-h-[calc(100dvh-11rem)] sm:min-h-[calc(100dvh-8.5rem)]">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 focus-within:border-amber-400/60">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (tag) onTag(null);
          }}
          placeholder="Search creators, videos or #hashtags"
          aria-label="Search"
          className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
        />
        {(q || tag) && (
          <button
            onClick={() => {
              setQ('');
              onTag(null);
            }}
            aria-label="Clear search"
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      )}

      {tag && tagged && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1 text-lg font-bold text-white">
            <Hash className="w-5 h-5 text-amber-400" />
            <bdi>{tag}</bdi>
            <span className="ml-1 text-sm font-normal text-slate-400">
              {tagged.length} video{tagged.length === 1 ? '' : 's'}
            </span>
          </h2>
          {tagged.length ? <Grid videos={tagged} /> : <p className="text-sm text-slate-400">No posted videos with #{tag} yet.</p>}
        </section>
      )}

      {searching && results && (
        <>
          {results.creators.length > 0 && (
            <section className="space-y-2">
              <h2 className={heading}>
                <Users className="w-4 h-4 text-sky-300" /> Creators
              </h2>
              <Creators creators={results.creators} />
            </section>
          )}
          {results.videos.length > 0 && (
            <section className="space-y-2">
              <h2 className={heading}>Videos</h2>
              <Grid videos={results.videos} />
            </section>
          )}
          {!results.creators.length && !results.videos.length && <p className="text-sm text-slate-400 text-center py-6">Nothing found for “{wanted}”.</p>}
        </>
      )}

      {!tag && !searching && trending && (
        <>
          {trending.tags.length > 0 && (
            <section className="space-y-2">
              <h2 className={heading}>
                <Hash className="w-4 h-4 text-amber-400" /> Popular hashtags
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {trending.tags.map((t) => (
                  <button key={t.tag} onClick={() => onTag(t.tag)} className="px-2.5 py-1 rounded-full bg-slate-800 text-xs text-slate-200 hover:bg-slate-700">
                    <bdi dir="ltr">#{t.tag}</bdi> <span className="text-slate-500">{t.videos}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="space-y-2">
            <h2 className={heading}>
              <Flame className="w-4 h-4 text-rose-400" /> Trending this week
            </h2>
            {trending.videos.length ? <Grid videos={trending.videos} badge="week" /> : <p className="text-sm text-slate-400">No videos posted lately.</p>}
          </section>
        </>
      )}
    </div>
  );
}
