import { useEffect, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { Bot, Check, Coins, CreditCard, Gauge, Globe, KeyRound, Loader2, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiError, adminApi, type AdminFeatures } from '../../shared/api';

const input = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50';
const primary = `${btn} bg-amber-400 hover:bg-amber-300 text-slate-950`;
const quiet = `${btn} border border-slate-700 text-slate-200 hover:bg-slate-800`;

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${on ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-700/60 text-slate-300'}`}>{label}</span>
  );
}

function Card({ icon: Icon, title, status, children }: { icon: typeof Bot; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <Icon className="w-4 h-4 text-amber-400" /> {title}
        </h2>
        {status}
      </div>
      {children}
    </section>
  );
}

const ServerNote = () => <p className="text-xs text-slate-400">Set on the server (Worker settings), which always wins. Change it there.</p>;

/** A saved key: shown as its last 4 characters only; a new one replaces it, Remove clears it. */
function KeyField({ label, saved, onSave, disabled, placeholder }: { label: string; saved: string | null; onSave: (v: string) => Promise<void>; disabled: boolean; placeholder?: string }) {
  const [value, setValue] = useState('');
  return (
    <div className="space-y-1">
      <span className="block text-xs text-slate-400">
        {label} {saved && <span className="font-mono text-slate-300">(saved {saved})</span>}
      </span>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder ?? (saved ? 'Paste a new one to replace it' : 'Paste it here')} className={input} disabled={disabled} />
        <button className={quiet} disabled={disabled || !value.trim()} onClick={() => onSave(value).then(() => setValue(''))}>
          Save
        </button>
        {saved && (
          <button className={`${btn} text-rose-300 hover:text-rose-200`} disabled={disabled} onClick={() => window.confirm(`Remove the saved ${label.toLowerCase()}?`) && onSave('')}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <code className="flex-1 min-w-0 truncate px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200">{value}</code>
      <button
        className={quiet}
        onClick={() => navigator.clipboard.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
      >
        {copied ? <Check className="w-4 h-4" /> : 'Copy'}
      </button>
    </div>
  );
}

/**
 * Features workspace: every feature that used to need the command line, ready to switch on with a
 * click (and the keys it needs pasted here, kept encrypted). Values set on the server win.
 */
export function FeaturesPanel({ password, onToken }: { password: string; onToken: (token: string, twoStep: boolean) => void }) {
  const [f, setF] = useState<AdminFeatures | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [limits, setLimits] = useState({ jobs: '', mb: '' });
  const [emailFrom, setEmailFrom] = useState('');
  const [clientId, setClientId] = useState('');

  const load = () =>
    adminApi
      .features(password)
      .then((r) => {
        setF(r);
        setLimits({ jobs: String(r.limits.max_jobs_per_hour), mb: String(r.limits.max_upload_mb) });
        setEmailFrom(r.email.from);
        setClientId(r.google.client_id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the features.'));
  useEffect(() => {
    load();
  }, [password]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, body: Record<string, unknown>, done?: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const r = await adminApi.feature(password, body);
      if (r.token) onToken(r.token, body.action === '2fa_confirm');
      if (done) setNote(done);
      await load();
      return r;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
      return null;
    } finally {
      setBusy(null);
    }
  }
  const set = (name: string, value: string, done = 'Saved.') => run(name, { action: 'set', name, value }, done).then(() => undefined);

  if (!f) {
    return <div className="p-6 text-sm text-slate-400">{error ?? <Loader2 className="w-5 h-5 animate-spin" />}</div>;
  }
  const qr = setup
    ? (() => {
        const q = qrcode(0, 'M');
        q.addData(setup.uri);
        q.make();
        return q.createDataURL(5, 2);
      })()
    : null;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-white">Features</h1>
        <p className="text-sm text-slate-400">Everything is ready: switch a feature on when you want it. Keys pasted here are stored encrypted and never shown again.</p>
      </div>
      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
      {note && <p className="p-3 text-sm rounded-xl border border-emerald-800 bg-emerald-950/60 text-emerald-200">{note}</p>}

      <Card icon={ShieldCheck} title="Two-step sign-in for this page" status={<Chip on={f.two_step.on} label={f.two_step.on ? 'On' : 'Off'} />}>
        <p className="text-sm text-slate-400">Signing in here also needs a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
        {f.two_step.source === 'server' ? (
          <ServerNote />
        ) : f.two_step.on ? (
          <div className="flex flex-wrap items-end gap-2">
            <input inputMode="numeric" autoComplete="one-time-code" placeholder="Current code" value={code} onChange={(e) => setCode(e.target.value)} className={`${input} max-w-[10rem]`} />
            <button className={quiet} disabled={busy !== null || code.replace(/\s/g, '').length !== 6} onClick={() => run('2fa', { action: '2fa_off', code }, 'Two-step sign-in is off.').then(() => setCode(''))}>
              Turn off
            </button>
          </div>
        ) : setup ? (
          <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
            {qr && <img src={qr} alt="QR code to scan with your authenticator app" className="w-44 h-44 rounded-lg bg-white p-1" />}
            <div className="space-y-2 text-sm">
              <p className="text-slate-300">1. Scan the code with your app (or add the key by hand):</p>
              <Copyable value={setup.secret} />
              <p className="text-slate-300">2. Type the 6-digit code the app shows:</p>
              <div className="flex gap-2">
                <input inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} className={`${input} max-w-[10rem]`} />
                <button
                  className={primary}
                  disabled={busy !== null || code.replace(/\s/g, '').length !== 6}
                  onClick={() =>
                    run('2fa', { action: '2fa_confirm', code }, 'Two-step sign-in is on. From now on this page asks for a code after the password.').then((r) => {
                      if (r) (setSetup(null), setCode(''));
                    })
                  }
                >
                  {busy === '2fa' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Turn on'}
                </button>
                <button className={quiet} onClick={() => (setSetup(null), setCode(''))}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button className={primary} disabled={busy !== null} onClick={() => run('2fa', { action: '2fa_start' }).then((r) => r?.secret && r.uri && setSetup({ secret: r.secret, uri: r.uri }))}>
            Set up
          </button>
        )}
      </Card>

      <Card icon={Coins} title="Credits" status={<Chip on={f.credits.on} label={f.credits.on ? 'On' : 'Off'} />}>
        <p className="text-sm text-slate-400">
          Off: translating is free and unlimited (within the limits below). On: each minute of video uses a credit; everyone gets free credits every day, and more when they sign in.
        </p>
        {f.credits.source === 'server' ? (
          <ServerNote />
        ) : (
          <button
            className={f.credits.on ? quiet : primary}
            disabled={busy !== null}
            onClick={() =>
              (f.credits.on || window.confirm('Turn credits on? Translations will start using credits right away.')) &&
              set('CREDITS_ENABLED', f.credits.on ? '' : '1', f.credits.on ? 'Credits are off.' : 'Credits are on.')
            }
          >
            {f.credits.on ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </Card>

      <Card icon={Gauge} title="Limits" status={<Chip on label={`${f.limits.max_jobs_per_hour}/hour · ${f.limits.max_upload_mb} MB`} />}>
        {f.limits.source === 'server' ? (
          <ServerNote />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-slate-400">Videos per person per hour</span>
              <input type="number" min={1} max={1000} value={limits.jobs} onChange={(e) => setLimits({ ...limits, jobs: e.target.value })} className={`${input} w-32`} />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-slate-400">Largest upload (MB)</span>
              <input type="number" min={1} max={2000} value={limits.mb} onChange={(e) => setLimits({ ...limits, mb: e.target.value })} className={`${input} w-32`} />
            </label>
            <button
              className={quiet}
              disabled={busy !== null}
              onClick={async () => {
                await set('MAX_JOBS_PER_HOUR', limits.jobs, '');
                await set('MAX_UPLOAD_MB', limits.mb, 'Limits saved.');
              }}
            >
              Save
            </button>
          </div>
        )}
      </Card>

      <Card icon={Mail} title="Sign in with email" status={<Chip on={f.email.ready} label={f.email.ready ? 'On' : 'Needs a key'} />}>
        <p className="text-sm text-slate-400">
          Sends a one-time sign-in link. Needs a free{' '}
          <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-amber-300 underline">
            Resend
          </a>{' '}
          account: verify your domain there, create an API key, and paste it below.
        </p>
        {f.email.source === 'server' ? (
          <ServerNote />
        ) : (
          <>
            <KeyField label="Resend API key" saved={f.email.key} disabled={busy !== null} onSave={(v) => set('RESEND_API_KEY', v)} placeholder="re_…" />
            <div className="flex gap-2">
              <input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="KAVOX <hello@your-domain.com>" className={input} />
              <button className={quiet} disabled={busy !== null || emailFrom === f.email.from} onClick={() => set('EMAIL_FROM', emailFrom)}>
                Save
              </button>
            </div>
          </>
        )}
      </Card>

      <Card icon={KeyRound} title="Sign in with Google" status={<Chip on={f.google.ready} label={f.google.ready ? 'On' : 'Needs a key'} />}>
        <p className="text-sm text-slate-400">
          In the{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-amber-300 underline">
            Google Cloud console
          </a>
          , create an OAuth client (Web application) with this redirect address, then paste its ID and secret:
        </p>
        <Copyable value={f.google.redirect_uri} />
        {f.google.source === 'server' ? (
          <ServerNote />
        ) : (
          <>
            <div className="flex gap-2">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (….apps.googleusercontent.com)" className={input} />
              <button className={quiet} disabled={busy !== null || clientId === f.google.client_id} onClick={() => set('GOOGLE_CLIENT_ID', clientId)}>
                Save
              </button>
            </div>
            <KeyField label="Client secret" saved={f.google.secret} disabled={busy !== null} onSave={(v) => set('GOOGLE_CLIENT_SECRET', v)} placeholder="GOCSPX-…" />
          </>
        )}
      </Card>

      <Card icon={CreditCard} title="Card payments (Stripe)" status={<Chip on={f.stripe.ready} label={f.stripe.ready ? 'On' : 'Off'} />}>
        <p className="text-sm text-slate-400">
          For buying credit packs and monthly plans by card (credits must be on). In{' '}
          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="text-amber-300 underline">
            Stripe
          </a>
          , copy the secret key, and add a webhook to this address (events: checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid), then paste its signing secret:
        </p>
        <Copyable value={f.stripe.webhook_url} />
        {f.stripe.source === 'server' ? (
          <ServerNote />
        ) : (
          <>
            <KeyField label="Secret key" saved={f.stripe.key} disabled={busy !== null} onSave={(v) => set('STRIPE_SECRET_KEY', v)} placeholder="sk_live_…" />
            <KeyField label="Webhook signing secret" saved={f.stripe.webhook_secret} disabled={busy !== null} onSave={(v) => set('STRIPE_WEBHOOK_SECRET', v)} placeholder="whsec_…" />
          </>
        )}
      </Card>

      <Card icon={Bot} title="Telegram bot" status={<Chip on={Boolean(f.telegram.bot)} label={f.telegram.bot ? `@${f.telegram.bot}` : 'Not connected'} />}>
        <p className="text-sm text-slate-400">After an update, refresh the bot so it gets messages from this server and shows the newest command menu (like /feedback).</p>
        <button className={quiet} disabled={busy !== null || !f.telegram.bot} onClick={() => run('bot', { action: 'bot_setup' }, 'The bot was refreshed.')}>
          {busy === 'bot' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh the bot
        </button>
      </Card>

      <Card icon={Globe} title="Your domain and HTTPS" status={<Chip on={Boolean(f.domain.public_domain)} label={f.domain.public_domain || 'workers.dev address'} />}>
        <p className="text-sm text-slate-400">
          Set your own domain in Settings. Then, in Cloudflare, open the domain → SSL/TLS → Edge Certificates and turn on <b>Always Use HTTPS</b> (the
          workers.dev address is HTTPS-only already).
        </p>
        <a href="https://dash.cloudflare.com/?to=/:account/:zone/ssl-tls/edge-certificates" target="_blank" rel="noreferrer" className={quiet}>
          Open Cloudflare
        </a>
      </Card>
    </div>
  );
}
