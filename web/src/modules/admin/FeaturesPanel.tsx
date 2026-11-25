import { useEffect, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { Activity, Bot, Check, Coins, CreditCard, Gauge, Globe, KeyRound, Loader2, Mail, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
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
function KeyField({ label, saved, onSave, disabled, placeholder }: { label: string; saved: string | null; onSave: (v: string) => Promise<boolean>; disabled: boolean; placeholder?: string }) {
  const [value, setValue] = useState('');
  return (
    <div className="space-y-1">
      <span className="block text-xs text-slate-400">
        {label} {saved && <span className="font-mono text-slate-300">(saved {saved})</span>}
      </span>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder ?? (saved ? 'Paste a new one to replace it' : 'Paste it here')} className={input} disabled={disabled} />
        <button className={quiet} disabled={disabled || !value.trim()} onClick={() => onSave(value).then((ok) => ok && setValue(''))}>
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

/** This project's GitHub repository (public): its security settings and Actions secrets live there. */
const REPO = 'FAJU85/vid-translate-';

/** Is GitHub's private vulnerability reporting on? Read from GitHub's public API (no key needed). */
function SecurityReportsCard() {
  const [on, setOn] = useState<boolean | null | 'error'>(null);
  const check = () => {
    setOn(null);
    fetch(`https://api.github.com/repos/${REPO}/private-vulnerability-reporting`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r: { enabled?: boolean }) => setOn(Boolean(r.enabled)))
      .catch(() => setOn('error'));
  };
  useEffect(check, []);
  return (
    <Card
      icon={ShieldAlert}
      title="Private security reports (GitHub)"
      status={on === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Chip on={on === true} label={on === 'error' ? 'Could not check' : on ? 'On' : 'Off'} />}
    >
      <p className="text-sm text-slate-400">
        Gives people a private way to tell you about a security problem (SECURITY.md points to it). On GitHub, open the repository's Settings → Code
        security → <b>Private vulnerability reporting</b> → Enable. Then check again here.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={`https://github.com/${REPO}/settings/security_analysis`} target="_blank" rel="noreferrer" className={primary}>
          Open GitHub settings
        </a>
        <button className={quiet} onClick={check}>
          <RefreshCw className="w-4 h-4" /> Check again
        </button>
      </div>
    </Card>
  );
}

/** The live system right now, and how to fix the automatic log collection (a GitHub workflow). */
function LogsCard() {
  const [health, setHealth] = useState<{ worker: boolean; backend: boolean } | null>(null);
  const check = () => {
    setHealth(null);
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r: { backend?: unknown }) => setHealth({ worker: true, backend: Boolean(r.backend) }))
      .catch(() => setHealth({ worker: false, backend: false }));
  };
  useEffect(check, []);
  return (
    <Card
      icon={Activity}
      title="System health and logs"
      status={health === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Chip on={health.worker && health.backend} label={health.worker && health.backend ? 'All running' : 'Needs a look'} />}
    >
      {health && (
        <ul className="text-sm text-slate-300 space-y-1">
          <li>Website and API (Cloudflare Worker): {health.worker ? 'running' : 'not answering'}</li>
          <li>Video engine (Hugging Face Space): {health.backend ? 'running' : 'not answering (it may be waking up: check again in a minute)'}</li>
        </ul>
      )}
      <button className={quiet} onClick={check}>
        <RefreshCw className="w-4 h-4" /> Check again
      </button>
      <div className="text-sm text-slate-400 space-y-1 pt-2 border-t border-slate-800">
        <p>
          The <b>Logs</b> workflow on GitHub collects the full logs after each deploy. It needs a working Cloudflare token (GitHub keeps it, so it is
          replaced there, never here):
        </p>
        <ol className="list-decimal ps-5 space-y-1">
          <li>
            In Cloudflare, open My Profile → API Tokens → <b>Create Token</b> → Custom token, with these Account permissions, all <b>Read</b>: Workers
            Scripts, Workers Tail, D1, Workers Builds Configuration.
          </li>
          <li>
            On GitHub, open the repository's Actions secrets, edit <b>CLOUDFLARE_API_TOKEN</b> and paste the new token (check that CLOUDFLARE_ACCOUNT_ID is
            there too).
          </li>
          <li>Run the Logs workflow once to see it work.</li>
        </ol>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className={quiet}>
          1. Cloudflare tokens
        </a>
        <a href={`https://github.com/${REPO}/settings/secrets/actions`} target="_blank" rel="noreferrer" className={quiet}>
          2. GitHub secrets
        </a>
        <a href={`https://github.com/${REPO}/actions/workflows/logs.yml`} target="_blank" rel="noreferrer" className={quiet}>
          3. Run the Logs workflow
        </a>
      </div>
    </Card>
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
  const [verification, setVerification] = useState('');

  const load = () =>
    adminApi
      .features(password)
      .then((r) => {
        setF(r);
        setLimits({ jobs: String(r.limits.max_jobs_per_hour), mb: String(r.limits.max_upload_mb) });
        setEmailFrom(r.email.from);
        setClientId(r.google.client_id);
        setVerification(r.search.verification);
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
      if (done) setNote(done);
      // A new sign-in token (two-step turned on or off): the page reloads with it, never with the old one.
      if (r.token) onToken(r.token, body.action === '2fa_confirm');
      else await load();
      return r;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
      return null;
    } finally {
      setBusy(null);
    }
  }
  /** Save one setting; true when it was saved (the field keeps what was typed otherwise). */
  const set = (name: string, value: string, done = 'Saved.') => run(name, { action: 'set', name, value }, done).then((r) => r !== null);
  /** Set on the server: shown, but changed there, not here. */
  const locked = (name: string) => f?.sources[name] === 'server';

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
      <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Launch</h2>
      <Card icon={Search} title="Google Search Console" status={<Chip on={Boolean(f.search.verification)} label={f.search.verification ? 'Check file ready' : 'Not set'} />}>
        {!f.domain.public_domain && (
          <p className="p-2 text-xs rounded-lg border border-amber-700 bg-amber-950/50 text-amber-100">
            Set your own domain in Settings first: Google ties the site to its address, so add it once that address is final.
          </p>
        )}
        <ol className="list-decimal ps-5 text-sm text-slate-400 space-y-1">
          <li>
            In{' '}
            <a href="https://search.google.com/search-console/welcome" target="_blank" rel="noreferrer" className="text-amber-300 underline">
              Search Console
            </a>
            , add a property → <b>URL prefix</b> → this address:
          </li>
        </ol>
        <Copyable value={f.search.site} />
        <ol start={2} className="list-decimal ps-5 text-sm text-slate-400 space-y-1">
          <li>
            Choose the <b>HTML file</b> check, copy the file's name (like google1a2b3c4d5e6f7a8b.html), paste it here and save. There's no need to upload anything: this
            site serves the file itself.
          </li>
        </ol>
        {locked('GOOGLE_SITE_VERIFICATION') ? (
          <ServerNote />
        ) : (
          <div className="flex gap-2">
            <input value={verification} onChange={(e) => setVerification(e.target.value)} placeholder="google1a2b3c4d5e6f7a8b.html" className={input} dir="ltr" />
            <button className={quiet} disabled={busy !== null || verification === f.search.verification} onClick={() => set('GOOGLE_SITE_VERIFICATION', verification)}>
              Save
            </button>
          </div>
        )}
        {f.search.file_url && (
          <a href={f.search.file_url} target="_blank" rel="noreferrer" className="text-xs text-amber-300 underline">
            Open the check file
          </a>
        )}
        <ol start={3} className="list-decimal ps-5 text-sm text-slate-400 space-y-1">
          <li>Press <b>Verify</b> in Google.</li>
          <li>
            Open <b>Sitemaps</b>, paste this address and press Submit. Google then reads it again by itself as new videos and profiles are posted:
          </li>
        </ol>
        <Copyable value={f.search.sitemap} />
      </Card>
      <SecurityReportsCard />
      <LogsCard />

      <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Features</h2>
      {f.unreadable.length > 0 && (
        <p className="p-3 text-sm rounded-xl border border-amber-700 bg-amber-950/50 text-amber-100">
          These saved keys cannot be read any more (the server's SHARED_SECRET changed): {f.unreadable.join(', ')}. Paste them again below.
        </p>
      )}

      <Card icon={ShieldCheck} title="Two-step sign-in for this page" status={<Chip on={f.two_step.on} label={f.two_step.on ? 'On' : 'Off'} />}>
        <p className="text-sm text-slate-400">Signing in here also needs a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
        {locked('ADMIN_TOTP_SECRET') ? (
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
        {locked('CREDITS_ENABLED') ? (
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
        {locked('MAX_JOBS_PER_HOUR') && locked('MAX_UPLOAD_MB') ? (
          <ServerNote />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-slate-400">Videos per person per hour</span>
              <input type="number" min={1} max={1000} disabled={locked('MAX_JOBS_PER_HOUR')} value={limits.jobs} onChange={(e) => setLimits({ ...limits, jobs: e.target.value })} className={`${input} w-32`} />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-slate-400">Largest upload (MB)</span>
              <input type="number" min={1} max={2000} disabled={locked('MAX_UPLOAD_MB')} value={limits.mb} onChange={(e) => setLimits({ ...limits, mb: e.target.value })} className={`${input} w-32`} />
            </label>
            <button
              className={quiet}
              disabled={busy !== null}
              onClick={async () => {
                if (!locked('MAX_JOBS_PER_HOUR') && !(await set('MAX_JOBS_PER_HOUR', limits.jobs, ''))) return;
                if (!locked('MAX_UPLOAD_MB')) await set('MAX_UPLOAD_MB', limits.mb, 'Limits saved.');
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
        {locked('RESEND_API_KEY') && locked('EMAIL_FROM') ? (
          <ServerNote />
        ) : (
          <>
            {locked('RESEND_API_KEY') ? <ServerNote /> : <KeyField label="Resend API key" saved={f.email.key} disabled={busy !== null} onSave={(v) => set('RESEND_API_KEY', v)} placeholder="re_…" />}
            {!locked('EMAIL_FROM') && <div className="flex gap-2">
              <input value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="KAVOX <hello@your-domain.com>" className={input} />
              <button className={quiet} disabled={busy !== null || emailFrom === f.email.from} onClick={() => set('EMAIL_FROM', emailFrom)}>
                Save
              </button>
            </div>}
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
        {locked('GOOGLE_CLIENT_ID') && locked('GOOGLE_CLIENT_SECRET') ? (
          <ServerNote />
        ) : (
          <>
            {!locked('GOOGLE_CLIENT_ID') && <div className="flex gap-2">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (….apps.googleusercontent.com)" className={input} />
              <button className={quiet} disabled={busy !== null || clientId === f.google.client_id} onClick={() => set('GOOGLE_CLIENT_ID', clientId)}>
                Save
              </button>
            </div>}
            {locked('GOOGLE_CLIENT_SECRET') ? <ServerNote /> : <KeyField label="Client secret" saved={f.google.secret} disabled={busy !== null} onSave={(v) => set('GOOGLE_CLIENT_SECRET', v)} placeholder="GOCSPX-…" />}
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
        {locked('STRIPE_SECRET_KEY') ? <ServerNote /> : <KeyField label="Secret key" saved={f.stripe.key} disabled={busy !== null} onSave={(v) => set('STRIPE_SECRET_KEY', v)} placeholder="sk_live_…" />}
        {locked('STRIPE_WEBHOOK_SECRET') ? <ServerNote /> : <KeyField label="Webhook signing secret" saved={f.stripe.webhook_secret} disabled={busy !== null} onSave={(v) => set('STRIPE_WEBHOOK_SECRET', v)} placeholder="whsec_…" />}
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
