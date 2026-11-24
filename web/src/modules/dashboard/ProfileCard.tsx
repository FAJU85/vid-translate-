import { useEffect, useState, type FormEvent } from 'react';
import { AtSign, Check, ExternalLink, Loader2, Pencil } from 'lucide-react';
import { ApiError, socialApi, type Profile } from '../../shared/api';

const HANDLE = /^(?=.{3,24}$)[a-z0-9_](?:[a-z0-9_]|\.(?!\.))*[a-z0-9_]$/;
const REASON: Record<string, string> = {
  invalid: '3 to 24 letters, digits, "_" or "." (not at the start or end)',
  reserved: 'reserved: choose another one',
  taken: 'taken: choose another one',
};

/**
 * Your public profile: claim a unique @handle (with a live "is it free?" check), a name and a
 * short bio, and open your page. Videos you post appear there.
 */
export function ProfileCard() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ handle: '', display_name: '', bio: '' });
  const [check, setCheck] = useState<{ handle: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeDays, setChangeDays] = useState(7);
  // Loading failed: different from "no profile yet" (that opens the form to create one).
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    socialApi
      .myProfile()
      .then((r) => {
        setProfile(r.profile);
        setChangeDays(r.change_days);
        if (!r.profile) setEditing(true);
      })
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const startEdit = () => {
    setForm({ handle: profile?.handle ?? '', display_name: profile?.display_name ?? '', bio: profile?.bio ?? '' });
    setEditing(true);
  };
  // Is the handle free? Asked once typing stops; only the latest answer is shown.
  const wanted = form.handle.trim().replace(/^@/, '').toLowerCase();
  useEffect(() => {
    setCheck(null);
    if (!editing || !wanted || wanted === profile?.handle) return;
    if (!HANDLE.test(wanted)) {
      setCheck({ handle: wanted, ok: false, text: REASON.invalid });
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      socialApi
        .handle(wanted)
        .then((r) => current && setCheck({ handle: wanted, ok: r.available, text: r.available ? 'available' : REASON[r.reason ?? 'taken'] }))
        .catch(() => {});
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted, editing, profile?.handle]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await socialApi.saveProfile({ handle: wanted, display_name: form.display_name, bio: form.bio });
      setProfile(r.profile);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-rose-300">Your profile could not be loaded.</span>
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">
          Try again
        </button>
      </section>
    );
  }
  if (profile === undefined) return null;
  const input = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-400/60';

  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-white flex items-center gap-1.5">
          <AtSign className="w-4 h-4 text-amber-400" /> Your profile
        </h2>
        {profile && !editing && (
          <div className="flex gap-2">
            <a
              href={`/@${profile.handle}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-800"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View profile
            </a>
            <button onClick={startEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-800">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        )}
      </div>

      {profile && !editing && (
        <div className="text-sm">
          <div className="text-white font-medium">{profile.display_name || `@${profile.handle}`}</div>
          <div className="text-slate-400">@{profile.handle}</div>
          {profile.bio && <p className="mt-1 text-slate-300 whitespace-pre-wrap break-words">{profile.bio}</p>}
          <p className="mt-2 text-xs text-slate-500">Videos you post ("Post to profile" on a video below) appear on your profile.</p>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="space-y-3">
          {!profile && <p className="text-sm text-slate-400">Choose a unique @handle to post your translated videos on your own page.</p>}
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Handle</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500">@</span>
              <input
                required
                value={form.handle}
                onChange={(e) => setForm({ ...form, handle: e.target.value })}
                placeholder="yourname"
                spellCheck={false}
                autoCapitalize="off"
                maxLength={25}
                className={input}
              />
            </div>
            {check && check.handle === wanted && (
              <span className={`block mt-1 text-xs ${check.ok ? 'text-status-done' : 'text-rose-300'}`}>
                @{check.handle}: {check.text}
              </span>
            )}
            {profile && <span className="block mt-1 text-xs text-slate-500">You can change your handle once every {changeDays} days.</span>}
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Name (optional)</span>
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={40} className={input} />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">Bio (optional)</span>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={160} rows={2} className={input} />
          </label>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button
              disabled={busy || (check !== null && check.handle === wanted && !check.ok)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-sm font-semibold text-slate-950"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {profile ? 'Save' : 'Create my profile'}
            </button>
            {profile && (
              <button type="button" onClick={() => setEditing(false)} className="px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
