import { useRef, useState } from 'react';
import { Film, Loader2, Trash2, Upload } from 'lucide-react';
import { ApiError, accountApi, type Outro, type OutroMode } from '../../shared/api';

const CHOICES: { mode: OutroMode; label: string; hint: string }[] = [
  { mode: 'kavox', label: 'KAVOX ending', hint: 'The KAVOX logo, 5 seconds' },
  { mode: 'custom', label: 'My own ending', hint: 'A clip you upload' },
  { mode: 'none', label: 'No ending', hint: 'The video ends where it ends' },
];

/**
 * The ending added to every video with burned-in subtitles or dubbing. Everyone gets the KAVOX
 * one; monthly plans may upload their own or have none.
 */
export function OutroSettings({ outro, onChange }: { outro: Outro; onChange: (o: Outro) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(0); // bumped after an upload so the player reloads
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function run(what: string, action: () => Promise<Outro>) {
    setBusy(what);
    setError(null);
    try {
      onChange(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > outro.max_mb * 1024 * 1024) return setError(`Your ending can be up to ${outro.max_mb} MB.`);
    run('upload', async () => {
      const next = await accountApi.uploadOutro(file);
      setPreview((n) => n + 1);
      return next;
    });
  }

  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Film className="w-3.5 h-3.5" /> Video ending
      </h3>
      {!outro.allowed ? (
        <>
          <p className="text-sm text-slate-400">
            Videos with burned-in subtitles or dubbing end with the 5-second KAVOX logo. With a monthly plan you can use your own
            ending, or none.
          </p>
          {outro.custom && outro.storage && (
            <button
              onClick={() => run('delete', accountApi.deleteOutro)}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-rose-300 disabled:opacity-60"
            >
              {busy === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Remove my saved ending
            </button>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Video ending">
            {CHOICES.map((c) => {
              const disabled = Boolean(busy) || (c.mode === 'custom' && !outro.custom);
              return (
                <button
                  key={c.mode}
                  role="radio"
                  aria-checked={outro.mode === c.mode}
                  disabled={disabled}
                  title={c.mode === 'custom' && !outro.custom ? 'Upload your ending first' : c.hint}
                  onClick={() => run(c.mode, () => accountApi.setOutro(c.mode))}
                  className={`px-2 py-2 rounded-lg border text-xs text-left disabled:opacity-50 ${
                    outro.mode === c.mode ? 'border-amber-400 bg-amber-400/10 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="block font-semibold">{busy === c.mode ? <Loader2 className="w-3 h-3 animate-spin inline" /> : c.label}</span>
                  <span className="block text-slate-500">{c.hint}</span>
                </button>
              );
            })}
          </div>
          {outro.custom && (
            <video key={preview} src={accountApi.outroFileUrl()} controls preload="metadata" className="w-full max-h-40 rounded-lg bg-black" />
          )}
          {outro.storage ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // the same file can be chosen again (after a failed upload)
                  upload(file);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
              >
                {busy === 'upload' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {outro.custom ? 'Replace my ending' : 'Upload my ending'}
              </button>
              {outro.custom && (
                <button
                  onClick={() => run('delete', accountApi.deleteOutro)}
                  disabled={Boolean(busy)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-rose-300 disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              )}
              <span className="w-full text-xs text-slate-500">
                A video up to {outro.max_mb} MB; the first {outro.max_seconds} seconds are used. It is fitted to each video’s size.
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Uploading your own ending is not available yet.</p>
          )}
        </>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </section>
  );
}
