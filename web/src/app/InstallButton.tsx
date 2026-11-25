import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { t } from '../shared/i18n';

/** The browser's install prompt (Chrome, Edge, Android), kept until the button is pressed. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

/**
 * "Install app": shown only where installing is possible and KAVOX is not already installed.
 * Chrome, Edge and Android get the browser's own prompt; iPhone and iPad Safari (no prompt) get
 * the two steps to add it to the home screen.
 */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [iosHelp, setIosHelp] = useState(false);
  const [installed, setInstalled] = useState(standalone);

  useEffect(() => {
    const keep = (e: Event) => {
      e.preventDefault(); // shown from our button instead of the browser's own banner
      setPrompt(e as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', keep);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', keep);
      window.removeEventListener('appinstalled', done);
    };
  }, []);

  if (installed || (!prompt && !isIos())) return null;

  async function install() {
    if (!prompt) return setIosHelp(true);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  }

  return (
    <>
      <button
        onClick={install}
        aria-label={t("Install the KAVOX app")}
        title={t("Install the KAVOX app")}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg border border-amber-400/50 text-amber-300 text-sm hover:bg-amber-400/10"
      >
        <Download className="w-4 h-4" />
        <span className="hidden md:inline">{t("Install app")}</span>
      </button>
      {iosHelp && (
        <div role="dialog" aria-modal="true" aria-label={t("Install on iPhone or iPad")} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={() => setIosHelp(false)}>
          <div className="w-full max-w-sm p-5 rounded-2xl border border-slate-700 bg-slate-900 space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-100">{t("Add KAVOX to your home screen")}</h2>
              <button onClick={() => setIosHelp(false)} aria-label={t("Close")} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-2 text-slate-300">
              <li className="flex items-center gap-2">
                {t("1. Tap")}{' '}<Share className="w-4 h-4 text-amber-300" /> <b className="text-slate-100">{t("Share")}</b>{' '}{t("in Safari's toolbar.")}
              </li>
              <li>
                {t("2. Choose")}{' '}<b className="text-slate-100">{t("Add to Home Screen")}</b>{t(", then")}{' '}<b className="text-slate-100">{t("Add")}</b>.
              </li>
            </ol>
            <p className="text-xs text-slate-500">{t("KAVOX then opens full screen, like an app.")}</p>
          </div>
        </div>
      )}
    </>
  );
}
