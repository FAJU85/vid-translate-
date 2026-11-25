import { useState } from 'react';
import { Check, Globe2, Loader2 } from 'lucide-react';
import { ApiError, dashboardApi, socialApi } from '../../shared/api';

/**
 * The last step of the journey: put the finished video on your profile and in the feed. Signing in
 * comes first; without an @handle the video is posted but people cannot find it yet, so say so.
 */
export function PostToProfile({ shareUrl, signedIn, onSignIn }: { shareUrl: string; signedIn: boolean; onSignIn?: () => void }) {
  const id = shareUrl.split('/').filter(Boolean).pop() ?? '';
  const [state, setState] = useState<'idle' | 'busy' | { handle: string | null }>('idle');
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setState('busy');
    setError(null);
    try {
      await dashboardApi.setVisibility(id, 'public');
      const me = await socialApi.myProfile().catch(() => null);
      setState({ handle: me?.profile?.handle ?? null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'It could not be posted. Try again from your Dashboard.');
      setState('idle');
    }
  }

  const box = 'p-3 rounded-xl border border-slate-700 bg-slate-950 flex flex-wrap items-center gap-3 text-sm';
  if (typeof state === 'object') {
    return (
      <div className={box}>
        <Check className="w-4 h-4 text-amber-300" />
        {state.handle ? (
          <span className="flex-1 text-slate-200">
            Posted.{' '}
            <a href={`/@${state.handle}`} className="text-amber-300 hover:underline">
              See it on @{state.handle}
            </a>{' '}
            or in the feed.
          </span>
        ) : (
          <span className="flex-1 text-slate-200">
            Posted. Choose your @handle on the{' '}
            <a href="/?tab=dashboard" className="text-amber-300 hover:underline">
              Dashboard
            </a>{' '}
            so people can find it.
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={box}>
      <Globe2 className="w-4 h-4 text-amber-300" />
      <span className="flex-1 min-w-[12rem] text-slate-300">
        {signedIn ? 'Post it to your profile and the feed, for everyone to watch.' : 'Sign in to post it to your profile and the feed.'}
      </span>
      {signedIn ? (
        <button
          onClick={post}
          disabled={state === 'busy'}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-60 font-semibold text-slate-950"
        >
          {state === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe2 className="w-4 h-4" />} Post to my profile
        </button>
      ) : (
        onSignIn && (
          <button onClick={onSignIn} className="px-3 py-2 rounded-lg border border-slate-600 text-slate-100 hover:bg-slate-800">
            Sign in
          </button>
        )
      )}
      {error && <p className="w-full text-xs text-rose-300">{error}</p>}
      <p className="w-full text-xs text-slate-500">
        Post only videos you have the right to share (
        <a href="/terms" target="_blank" rel="noreferrer" className="underline">
          Terms
        </a>
        ).
      </p>
    </div>
  );
}
