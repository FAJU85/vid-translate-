import { useEffect, useState } from 'react';
import { RefreshCw, Smartphone, X } from 'lucide-react';
import { t } from '../shared/i18n';
import { BUILD_ID, checkServiceWorker, liveBuild, updatesHeld } from '../shared/updates';

/** How often an open, visible app asks whether a newer KAVOX is out. */
const CHECK_MS = 10 * 60_000;
/** Back after this long in the background, with nothing in progress: update without asking. */
const AWAY_MS = 30 * 60_000;

/**
 * "A new version of KAVOX is ready": checked every 10 minutes while the app is on screen, when it
 * comes back to the screen, and when the connection returns. After a long time away with nothing
 * in progress, the app simply reloads into the new version; otherwise it shows the Refresh notice.
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (BUILD_ID === 'dev') return;
    let hiddenAt: number | null = null;
    const check = async (cameBackAfter = 0) => {
      const live = await liveBuild();
      if (!live || live === BUILD_ID) return;
      if (cameBackAfter >= AWAY_MS && !updatesHeld()) {
        window.location.reload();
        return;
      }
      setReady(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      checkServiceWorker();
      void check(away);
    };
    const onOnline = () => void check();
    const timer = setInterval(() => document.visibilityState === 'visible' && void check(), CHECK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!ready) return null;
  const refresh = () => {
    if (updatesHeld() && !window.confirm(t('A video or an upload is in progress here. Refresh now anyway?'))) return;
    window.location.reload();
  };
  return (
    <div role="status" className="fixed inset-x-0 bottom-20 sm:bottom-4 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 max-w-md w-full p-3 rounded-xl border border-teal-700 bg-slate-900/95 backdrop-blur shadow-lg text-sm text-slate-100">
        <RefreshCw className="w-4 h-4 text-teal-300 shrink-0" aria-hidden />
        <span className="flex-1">{t('A new version of KAVOX is ready.')}</span>
        <button type="button" onClick={refresh} className="px-3 py-1.5 rounded-lg bg-teal-400 hover:bg-teal-300 text-slate-950 font-semibold">
          {t('Refresh')}
        </button>
        <button type="button" onClick={() => setReady(false)} aria-label={t('Close')} className="p-1 text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Bump when the app icon changes: iPhones keep the icon they saved when the app was added. */
const ICON_VERSION = '2';
const ICON_KEY = 'kavox_icon';

/**
 * iPhone and iPad keep the Home Screen icon they saved when KAVOX was added, for good. Someone who
 * added it before the icon changed is told once how to get the new one; a new install is not.
 */
export function IconHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const standaloneIos = (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!standaloneIos || localStorage.getItem(ICON_KEY) === ICON_VERSION) return;
      // The installed app has its own storage: anything of ours there means it was used before.
      const usedBefore = Object.keys(localStorage).some((k) => k.startsWith('kavox_') && k !== ICON_KEY);
      if (usedBefore) setShow(true);
      else localStorage.setItem(ICON_KEY, ICON_VERSION);
    } catch {
      /* storage blocked: nothing to remember, so say nothing */
    }
  }, []);
  if (!show) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(ICON_KEY, ICON_VERSION);
    } catch {
      /* shown again next time */
    }
  };
  return (
    <div role="status" className="mb-6 flex items-start gap-3 p-3 rounded-xl border border-teal-700 bg-teal-950/40 text-sm text-slate-100 relative pe-10">
      <Smartphone className="w-5 h-5 text-teal-300 shrink-0 mt-0.5" aria-hidden />
      <span>
        <b>{t('KAVOX has a new icon.')}</b>{' '}
        {t('Your iPhone keeps the old one. To see the new icon: sign in first (so your videos stay with your account), remove KAVOX from your Home Screen, open this site in Safari, tap Share → Add to Home Screen, and sign in again.')}
      </span>
      <button type="button" onClick={close} aria-label={t('Close')} className="absolute top-2 end-2 p-1 text-slate-400 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
