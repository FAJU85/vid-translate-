import { useEffect, useState, type FormEvent } from 'react';
import { AtSign, Camera, Check, ExternalLink, Loader2, Pencil, Trash2 } from 'lucide-react';
import { ApiError, socialApi, type Profile } from '../../shared/api';
import { t } from '../../shared/i18n';
import { Avatar, squarePhoto } from '../../shared/avatar';

const HANDLE = /^(?=.{3,24}$)[a-z0-9_](?:[a-z0-9_]|\.(?!\.))*[a-z0-9_]$/;
const REASON: Record<string, string> = {
  invalid: t('3 to 24 letters, digits, "_" or "." (not at the start or end)'),
  reserved: t('reserved: choose another one'),
  taken: t('taken: choose another one'),
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function pickPhoto(file: File | undefined) {
    if (!file || !profile) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const photo = await squarePhoto(file).catch(() => {
        throw new ApiError('E_BAD_REQUEST', t('That picture could not be read. Try a JPEG or PNG photo.'));
      });
      const r = await socialApi.setAvatar(photo);
      setProfile({ ...profile, avatar_url: r.avatar_url, photo_taken_down: false });
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : t('Your photo could not be saved.'));
    } finally {
      setPhotoBusy(false);
    }
  }
  async function removePhoto() {
    if (!profile || !window.confirm(t('Remove your profile photo?'))) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await socialApi.removeAvatar();
      setProfile({ ...profile, avatar_url: null, photo_taken_down: false });
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : t('Your photo could not be removed.'));
    } finally {
      setPhotoBusy(false);
    }
  }

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
        .then((r) => current && setCheck({ handle: wanted, ok: r.available, text: r.available ? t('available') : REASON[r.reason ?? 'taken'] }))
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
      setError(err instanceof ApiError ? err.message : t("Could not save your profile."));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-rose-300">{t("Your profile could not be loaded.")}</span>
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">
          {t("Try again")}
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
          <AtSign className="w-4 h-4 text-amber-400" />{' '}{t("Your profile")}
        </h2>
        {profile && !editing && (
          <div className="flex gap-2">
            <a
              href={`/@${profile.handle}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-800"
            >
              <ExternalLink className="w-3.5 h-3.5" />{' '}{t("View profile")}
            </a>
            <button onClick={startEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-800">
              <Pencil className="w-3.5 h-3.5" />{' '}{t("Edit")}
            </button>
          </div>
        )}
      </div>

      {profile && !editing && (
        <div className="text-sm">
          <div className="flex items-center gap-3 mb-2">
            <Avatar handle={profile.handle} url={profile.avatar_url} className="w-16 h-16 text-2xl" />
            <div className="flex flex-wrap gap-2">
              <label className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer ${photoBusy ? 'opacity-50 pointer-events-none' : ''}`}>
                {photoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}{' '}
                {profile.avatar_url ? t('Change photo') : t('Add a photo')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    void pickPhoto(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {(profile.avatar_url || profile.photo_taken_down) && (
                <button type="button" onClick={removePhoto} disabled={photoBusy} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-rose-300 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />{' '}{t('Remove photo')}
                </button>
              )}
            </div>
          </div>
          {photoError && <p className="mb-2 text-xs text-rose-300">{photoError}</p>}
          {profile.photo_taken_down && (
            <p className="mb-2 text-xs text-rose-300">{t('Your photo was taken down after a report: no one sees it. Add another one, or remove it.')}</p>
          )}
          <div className="text-white font-medium">{profile.display_name || `@${profile.handle}`}</div>
          <div className="text-slate-400"><bdi dir="ltr">@{profile.handle}</bdi></div>
          {profile.bio && <p className="mt-1 text-slate-300 whitespace-pre-wrap break-words">{profile.bio}</p>}
          <p className="mt-2 text-xs text-slate-500">
            {t("Videos you post (\"Post to profile\" on a video below) appear on your profile, in the feed, and can get likes and comments. By posting you agree to the")}{' '}
            <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-slate-300">
              {t("Terms")}
            </a>
            {t(": post only videos you have the right to share.")}
          </p>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="space-y-3">
          {!profile && <p className="text-sm text-slate-400">{t("Choose a unique @handle to post your translated videos on your own page.")}</p>}
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">{t("Handle")}</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500">@</span>
              <input
                required
                value={form.handle}
                onChange={(e) => setForm({ ...form, handle: e.target.value })}
                placeholder={t("yourname")}
                spellCheck={false}
                autoCapitalize="off"
                maxLength={25}
                className={input}
              />
            </div>
            {check && check.handle === wanted && (
              <span className={`block mt-1 text-xs ${check.ok ? 'text-status-done' : 'text-rose-300'}`}>
                <bdi dir="ltr">@{check.handle}</bdi>: {check.text}
              </span>
            )}
            {profile && <span className="block mt-1 text-xs text-slate-500">{t("You can change your handle once every")}{' '}{changeDays}{' '}{t("days.")}</span>}
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">{t("Name (optional)")}</span>
            <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={40} className={input} />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1">{t("Bio (optional)")}</span>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={160} rows={2} className={input} />
          </label>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button
              disabled={busy || (check !== null && check.handle === wanted && !check.ok)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-sm font-semibold text-slate-950"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {profile ? t("Save") : t("Create my profile")}
            </button>
            {profile && (
              <button type="button" onClick={() => setEditing(false)} className="px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white">
                {t("Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
