import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { ApiError, adminApi, type AdminSettings } from '../../shared/api';
import { DEFAULT_LOGO, LOGO_SIZE, SITE, logoSize } from '../../shared/content';

const MAX_LOGO_KB = 256;

const inputClass =
  'w-full px-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400';

const EMPTY: AdminSettings = { name: '', accent: '', translate_title: '', translate_intro: '', welcome_en: '', welcome_ar: '', public_domain: '', takedown_email: '', logo_size: '' };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-200 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1.5 text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Settings workspace: one form for the name, logo, colour and main texts. Saving is live at once. */
export function SettingsPanel({ password }: { password: string }) {
  const [loaded, setLoaded] = useState(false);
  const [values, setValues] = useState<AdminSettings>(EMPTY);
  const [logo, setLogo] = useState<{ dataUrl: string } | 'remove' | null>(null); // null = unchanged
  const [hasLogo, setHasLogo] = useState(false);
  const [savedAt, setSavedAt] = useState(() => Date.now()); // busts the cached logo after a save
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: keyof AdminSettings) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  useEffect(() => {
    adminApi
      .load(password)
      .then((saved) => {
        setValues({ ...EMPTY, ...saved });
        setHasLogo(Boolean(saved.has_logo));
        setLoaded(true);
      })
      .catch((err) => setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not load the settings.' }));
  }, [password]);

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_LOGO_KB * 1024) {
      setMessage({ ok: false, text: `The logo must be smaller than ${MAX_LOGO_KB} KB.` });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo({ dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // Banners are saved on their own page: never send back a copy loaded earlier.
      const { has_logo: _ignored, blocks: _blocks, ...fields } = values;
      const payload: Partial<AdminSettings> = { ...fields };
      if (logo === 'remove') payload.logo = '';
      else if (logo) payload.logo = logo.dataUrl;
      await adminApi.save(password, payload);
      if (logo) setHasLogo(logo !== 'remove');
      setSavedAt(Date.now());
      setLogo(null);
      setMessage({ ok: true, text: 'Saved. The website and the bot use the new settings right away.' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  const notice = message && (
    <p
      className={`p-3 text-sm rounded-xl border ${
        message.ok ? 'border-emerald-800 bg-emerald-950/60 text-emerald-200' : 'border-rose-800 bg-rose-950/60 text-rose-200'
      }`}
    >
      {message.ok && <CheckCircle2 className="inline w-4 h-4 mr-1.5 -mt-0.5" />}
      {message.text}
    </p>
  );

  if (!loaded) return <div className="p-8 flex justify-center text-slate-500">{notice ?? <Loader2 className="w-5 h-5 animate-spin" />}</div>;

  const logoPreview = logo === 'remove' ? '' : logo ? logo.dataUrl : hasLogo ? `/api/logo?t=${savedAt}` : '';

  return (
    <form onSubmit={save} className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Leave a field empty to use the default shown in grey.</p>
      </div>

      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
        <h2 className="font-semibold text-white">Branding</h2>
        <Field label="Platform name">
          <input value={values.name} onChange={set('name')} placeholder={SITE.brand.name} className={inputClass} />
        </Field>

        <div>
          <span className="block text-sm font-medium text-slate-200 mb-1.5">Logo</span>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 shrink-0 rounded-xl border border-slate-700 bg-slate-950 flex items-center justify-center overflow-hidden">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : DEFAULT_LOGO ? (
                // No logo uploaded: the site shows the built-in one.
                <img src={DEFAULT_LOGO} alt="Built-in logo" className="max-w-full max-h-full object-contain opacity-80" />
              ) : (
                <span className="text-amber-400 font-bold">{(SITE.brand.mark || SITE.brand.name).slice(0, 1)}</span>
              )}
            </div>
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800">
              <ImagePlus className="w-4 h-4" /> Upload
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0])} />
            </label>
            {logoPreview && (
              <button type="button" onClick={() => setLogo('remove')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-rose-300">
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            )}
          </div>
          <span className="block mt-1.5 text-xs text-slate-500">
            PNG, JPEG, WebP or SVG, up to {MAX_LOGO_KB} KB. A square image works best. Also used as the browser-tab icon.
          </span>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor="logo-size" className="text-sm font-medium text-slate-200">
              Logo size
            </label>
            <span className="text-xs tabular-nums text-slate-400">
              {logoSize(values.logo_size)} px{!values.logo_size && ' (default)'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="logo-size"
              type="range"
              min={LOGO_SIZE.min}
              max={LOGO_SIZE.max}
              step={2}
              value={logoSize(values.logo_size)}
              onChange={(e) => setValues((v) => ({ ...v, logo_size: Number(e.target.value) === LOGO_SIZE.default ? '' : e.target.value }))}
              className="flex-1 accent-amber-400"
            />
            {values.logo_size && (
              <button type="button" onClick={() => setValues((v) => ({ ...v, logo_size: '' }))} className="text-xs text-slate-400 hover:text-white">
                Reset
              </button>
            )}
          </div>
          {/* How the header will look: the logo at this size next to the name. */}
          <div className="mt-3 flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-800 bg-slate-950">
            <img
              src={logoPreview || DEFAULT_LOGO}
              alt=""
              className="w-auto object-contain"
              style={{ height: logoSize(values.logo_size), maxWidth: logoSize(values.logo_size) * 4 }}
            />
            <span className="text-lg font-extrabold tracking-[0.14em] text-slate-100">{values.name || SITE.brand.name}</span>
            <span className="ml-auto text-[11px] text-slate-500">Header preview</span>
          </div>
          <span className="block mt-1.5 text-xs text-slate-500">
            The logo's height in the header of the website and of video, profile and Terms pages ({LOGO_SIZE.min}–{LOGO_SIZE.max} px).
          </span>
        </div>

        <Field label="Accent colour" hint="Buttons and highlights.">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={values.accent || SITE.brand.accent}
              onChange={set('accent')}
              className="w-12 h-10 rounded-lg border border-slate-700 bg-slate-950 cursor-pointer"
            />
            <span className="text-sm text-slate-400 font-mono">{values.accent || `${SITE.brand.accent} (default)`}</span>
            {values.accent && (
              <button type="button" onClick={() => setValues((v) => ({ ...v, accent: '' }))} className="text-xs text-slate-400 hover:text-white">
                Reset
              </button>
            )}
          </div>
        </Field>
      </section>

      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
        <h2 className="font-semibold text-white">Public address</h2>
        <Field
          label="Domain for links"
          hint="Video links become https://<domain>/<id> and profiles https://<domain>/@handle. First add the domain to the Worker in Cloudflare (Workers → vid-translate → Settings → Domains & Routes → Add → Custom domain), wait until it opens, then save it here: KAVOX checks that it reaches this site before saving. Empty: the Worker's own address."
        >
          <input
            value={values.public_domain}
            onChange={set('public_domain')}
            placeholder="kavox.to"
            spellCheck={false}
            autoCapitalize="off"
            className={inputClass}
          />
        </Field>
      </section>

      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
        <h2 className="font-semibold text-white">Terms and takedowns</h2>
        <Field
          label="Takedown email"
          hint="Shown on the Terms page (/terms, linked from every video and profile page) for copyright owners to send takedown notices. Reports from the site arrive in Reports."
        >
          <input type="email" value={values.takedown_email} onChange={set('takedown_email')} placeholder="copyright@yourdomain.com" spellCheck={false} autoCapitalize="off" className={inputClass} />
        </Field>
        <a href="/terms" target="_blank" rel="noreferrer" className="inline-block text-xs text-amber-300 hover:underline">
          Open the Terms page
        </a>
      </section>

      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
        <h2 className="font-semibold text-white">Home page</h2>
        <Field label="Main heading">
          <input value={values.translate_title} onChange={set('translate_title')} placeholder={SITE.translate.title} className={inputClass} />
        </Field>
        <Field label="Introduction">
          <textarea rows={3} value={values.translate_intro} onChange={set('translate_intro')} placeholder={SITE.translate.intro} className={inputClass} />
        </Field>
      </section>

      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
        <h2 className="font-semibold text-white">Telegram bot</h2>
        <Field label="Welcome message (English)" hint="Sent on /start and /help. Plain text; {lang} becomes the chosen language.">
          <textarea rows={5} value={values.welcome_en} onChange={set('welcome_en')} placeholder="Default welcome message" className={inputClass} />
        </Field>
        <Field label="Welcome message (Arabic)">
          <textarea rows={5} dir="rtl" value={values.welcome_ar} onChange={set('welcome_ar')} placeholder="رسالة الترحيب الافتراضية" className={inputClass} />
        </Field>
      </section>

      {notice}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="px-6 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold">
          {busy ? <Loader2 className="inline w-4 h-4 animate-spin" /> : 'Save'}
        </button>
        <a href="/" className="text-sm text-slate-400 hover:text-white">
          View the website
        </a>
      </div>
    </form>
  );
}
