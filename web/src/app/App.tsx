import { Suspense, lazy, useEffect, useState } from 'react';
import { DashboardView } from '../modules/dashboard';
import { FeedView } from '../modules/feed';
import { PricingView } from '../modules/pricing';
import { TelegramView } from '../modules/telegram';
import { TranslateView } from '../modules/translate';
import { AccountButton, AccountDialog } from '../modules/account';
import { NotificationBell } from '../modules/notifications';
import { InstallButton } from './InstallButton';
import { accountApi, api, type AppConfig, type Me } from '../shared/api';
import { SITE, applySiteSettings } from '../shared/content';
import { Header, type NavTab } from './Header';
import { t } from '../shared/i18n';

// The dashboard (drag and drop, virtual lists) is only downloaded by people who open /admin.
const AdminView = lazy(() => import('../modules/admin').then((m) => ({ default: m.AdminView })));

const IS_ADMIN = window.location.pathname.replace(/\/+$/, '') === '/admin';

// How long the website keeps checking for credits after a payment page or the bot was opened.
const PAYMENT_WAIT_MS = 30 * 60 * 1000;
const PAYMENT_POLL_MS = 4000;

const SIGNIN_NOTICE: Record<string, string> = {
  ok: t("You are signed in."),
  expired: t("That sign-in link has expired or was already used. Ask for a new one."),
  failed: t("Signing in with Google did not work. Please try again."),
  unavailable: t("That way of signing in is not available."),
};

export default function App() {
  return IS_ADMIN ? (
    <div className="selection:bg-amber-400 selection:text-slate-950">
      <Suspense fallback={null}>
        <AdminView />
      </Suspense>
    </div>
  ) : (
    <Site />
  );
}

function Site() {
  // ?tab=pricing opens the prices (links from the bot).
  const [tab, setTab] = useState<NavTab>(() => {
    const asked = new URLSearchParams(window.location.search).get('tab');
    return asked === 'pricing' || asked === 'dashboard' || asked === 'feed' || asked === 'telegram' ? asked : 'translate';
  });
  // Shared to the installed app from another app (Android share sheet): the video link it carries.
  const [sharedLink] = useState<string | null>(() => {
    const q = new URLSearchParams(window.location.search);
    return [q.get('link'), q.get('text'), q.get('title')].map((v) => v?.match(/https?:\/\/\S+/)?.[0]).find(Boolean) ?? null;
  });
  const [jobId, setJobId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('job'));
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  // Coming back from an email link or Google: ?signin=ok|expired|failed|unavailable.
  const [signinNotice, setSigninNotice] = useState<string | null>(() => {
    const result = new URLSearchParams(window.location.search).get('signin');
    return result ? SIGNIN_NOTICE[result] ?? null : null;
  });
  const [accountOpen, setAccountOpen] = useState(Boolean(signinNotice));
  // Stripe sends people back to /?paid=1 in the payment tab: the original tab carries on by itself.
  const [paidTab] = useState(() => new URLSearchParams(window.location.search).get('paid') === '1');
  // Waiting for a payment: when the balance grows, go back and start the refused video again.
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const [resume, setResume] = useState(0);
  const [paidNotice, setPaidNotice] = useState(false);
  const refreshMe = () => accountApi.me().then(setMe, () => {});

  useEffect(() => {
    refreshMe();
    const url = new URL(window.location.href);
    const once = ['signin', 'paid', 'tab', 'link', 'text', 'title', 'source'];
    if (once.some((k) => url.searchParams.has(k))) {
      once.forEach((k) => url.searchParams.delete(k));
      window.history.replaceState(null, '', url);
    }
  }, []);

  useEffect(() => {
    if (!awaitingSince) return;
    // A new payment, not any rise in the balance (a refund also raises it).
    const before = me?.payments?.count ?? 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (Date.now() - awaitingSince > PAYMENT_WAIT_MS) return setAwaitingSince(null);
      const next = await accountApi.me().catch(() => null);
      if (!next || cancelled) return; // an answer that came after the wait ended
      setMe(next);
      if ((next.payments?.count ?? 0) > before) {
        setAwaitingSince(null);
        setPaidNotice(true);
        setTab('translate');
        setResume((n) => n + 1);
      }
    }, PAYMENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingSince]);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        applySiteSettings(c.site); // before setConfig, so the re-render shows the saved name, logo and texts
        setConfig(c);
      })
      .catch(() => setConfigError(true));
  }, []);

  // Keep the address bar shareable: ?job=<id> reopens the same result.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');
    window.history.replaceState(null, '', url);
  }, [jobId]);

  return (
    <div className="min-h-screen flex flex-col selection:bg-amber-400 selection:text-slate-950">
      <Header tab={tab} onTab={setTab} showPricing={Boolean(me?.credits_enabled)} account={
          <>
          <InstallButton />
          {me?.account && <NotificationBell key={me.account.id} />}
          <AccountButton
            me={me}
            onOpen={() => {
              refreshMe(); // the balance may have changed since (a job finished or was refunded)
              setAccountOpen(true);
            }}
          />
          </>
        } />
      {accountOpen && me && (
        <AccountDialog
          me={me}
          notice={signinNotice}
          onChange={setMe}
          onClose={() => {
            setAccountOpen(false);
            setSigninNotice(null);
          }}
        />
      )}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 pt-8 pb-24 sm:pb-8">
        {paidTab && (
          <div className="mb-6 p-3 text-sm rounded-xl border border-emerald-800 bg-emerald-950/60 text-emerald-200">
            {t("Payment received, thank you! Your credits are added in a few seconds. If you started a translation in another tab, it continues there by itself; you can close this one.")}
          </div>
        )}
        {paidNotice && (
          <div className="mb-6 p-3 text-sm rounded-xl border border-emerald-800 bg-emerald-950/60 text-emerald-200">
            {t("Payment received: your credits are here.")}
          </div>
        )}
        {awaitingSince && (
          <div className="mb-6 p-3 text-sm rounded-xl border border-slate-700 bg-slate-900 text-slate-200">
            {t("Waiting for your payment… Finish it in the other tab or in Telegram; this page carries on by itself.")}
          </div>
        )}
        {configError && (
          <div className="mb-6 p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">
            {t("The service is not reachable right now. If you run this site, check that")}{' '}<code>{t("VITE_API_BASE")}</code>{' '}{t("points at your Worker.")}
          </div>
        )}
        {/* Stays mounted so an upload in progress survives switching tabs. */}
        <div className={tab === 'translate' ? '' : 'hidden'}>
          <TranslateView
            config={config}
            jobId={jobId}
            onJob={setJobId}
            onCreditsChanged={refreshMe}
            me={me}
            onPricing={() => setTab('pricing')}
            onSignIn={() => setAccountOpen(true)}
            onFeed={() => setTab('feed')}
            initialLink={sharedLink}
            resume={resume}
          />
        </div>
        {tab === 'dashboard' && (
          <DashboardView
            me={me}
            config={config}
            onMe={setMe}
            onOpenJob={(id) => {
              setJobId(id);
              setTab('translate');
            }}
            onSignIn={() => setAccountOpen(true)}
            onPricing={() => setTab('pricing')}
            onTranslate={() => setTab('translate')}
          />
        )}
        {tab === 'feed' && <FeedView config={config} signedIn={Boolean(me?.account)} onSignIn={() => setAccountOpen(true)} />}
        {tab === 'telegram' && <TelegramView config={config} />}
        {tab === 'pricing' && (
          <PricingView me={me} config={config} onSignIn={() => setAccountOpen(true)} onPaymentStarted={() => setAwaitingSince(Date.now())} />
        )}
      </main>
      <footer className={`${tab === 'feed' ? 'hidden sm:block ' : ''}border-t border-slate-900 pt-5 pb-24 sm:pb-5 px-4 text-center text-xs text-slate-500`}>
        {SITE.brand.footer} ·{' '}
        <a href="/terms" className="hover:text-slate-300 underline-offset-2 hover:underline">
          {t("Terms")}
        </a>
      </footer>
    </div>
  );
}
