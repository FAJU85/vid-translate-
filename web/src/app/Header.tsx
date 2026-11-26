import type { ReactNode } from 'react';
import { Bot, Clapperboard, Languages, LayoutDashboard, Music, Tag } from 'lucide-react';
import { SITE, logoSize } from '../shared/content';
import { LANG, setLang } from '../shared/i18n';
import { t } from '../shared/i18n';

export type NavTab = 'translate' | 'lyrics' | 'feed' | 'dashboard' | 'telegram' | 'pricing';

/** `short`: the label under the icon in the phone tab bar. */
const TABS: { id: NavTab; label: string; short: string; icon: typeof Bot }[] = [
  { id: 'translate', label: t("Translate"), short: t("Translate"), icon: Languages },
  { id: 'lyrics', label: t("Lyrics video"), short: t("Lyrics"), icon: Music },
  { id: 'feed', label: t("Feed"), short: t("Feed"), icon: Clapperboard },
  { id: 'dashboard', label: t("Dashboard"), short: t("Mine"), icon: LayoutDashboard },
  { id: 'telegram', label: t("Telegram bot"), short: t("Bot"), icon: Bot },
  { id: 'pricing', label: t("Pricing"), short: t("Pricing"), icon: Tag },
];

export function Header({ tab, onTab, account, showPricing = false }: {
  tab: NavTab;
  onTab: (tab: NavTab) => void;
  account?: ReactNode;
  /** Prices only mean something once credits are on. */
  showPricing?: boolean;
}) {
  const tabs = TABS.filter((t) => t.id !== 'pricing' || showPricing);
  return (
    <>
    <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-2 sm:gap-4">
        <button onClick={() => onTab('translate')} aria-label={`${SITE.brand.name}: home`} className="flex items-center gap-2.5 shrink-0">
          {SITE.brand.logo ? (
            // The admin chooses the height; a wide logo keeps its shape (up to four times as wide).
            <img
              src={SITE.brand.logo}
              alt=""
              className="w-auto object-contain"
              style={{ height: logoSize(SITE.brand.logoSize), maxWidth: logoSize(SITE.brand.logoSize) * 4 }}
            />
          ) : (
            <span className="h-9 w-9 rounded-xl bg-amber-400 text-slate-950 font-black flex items-center justify-center">{(SITE.brand.mark || SITE.brand.name).slice(0, 1)}</span>
          )}
          {/* The approved wordmark while the site is called KAVOX; a renamed site shows its name. */}
          {SITE.brand.name === 'KAVOX' && SITE.brand.wordmark ? (
            <img src={SITE.brand.wordmark} alt="KAVOX" className="w-auto" style={{ height: Math.round(logoSize(SITE.brand.logoSize) * 0.6) }} />
          ) : (
            <span className="text-lg font-extrabold tracking-[0.14em] text-slate-100">{SITE.brand.name}</span>
          )}
        </button>
        {/* Tablets and computers: the tabs in the header. */}
        <nav aria-label={t("Main")} className="hidden sm:flex items-center gap-1 text-sm min-w-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                tab === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              <span className={id === 'telegram' ? 'hidden md:inline' : undefined}>{label}</span>
              {id === 'telegram' && <span className="md:hidden">{t("Bot")}</span>}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1 shrink-0">
          {/* The other language, in its own script: "ع" switches to Arabic, "EN" back to English. */}
          <button
            onClick={() => setLang(LANG === 'ar' ? 'en' : 'ar')}
            aria-label={LANG === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
            title={LANG === 'ar' ? 'English' : 'العربية'}
            lang={LANG === 'ar' ? 'en' : 'ar'}
            className="h-8 min-w-8 px-2 rounded-lg border border-slate-700 text-sm font-bold text-slate-200 hover:bg-slate-800"
          >
            {LANG === 'ar' ? 'EN' : 'ع'}
          </button>
          {account}
        </div>
      </div>
    </header>
    {/* Phones: a tab bar at the bottom, in reach of the thumb, with labels (as in most phone apps). */}
    <nav
      aria-label={t("Main")}
      className="sm:hidden fixed inset-x-0 bottom-0 z-40 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex">
        {tabs.map(({ id, short, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] ${tab === id ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}
          >
            <span className={`px-4 py-1 rounded-full ${tab === id ? 'bg-amber-400/15' : ''}`}>
              <Icon className="w-5 h-5" aria-hidden />
            </span>
            <span className="truncate max-w-full">{short}</span>
          </button>
        ))}
      </div>
    </nav>
    </>
  );
}
