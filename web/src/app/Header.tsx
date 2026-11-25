import type { ReactNode } from 'react';
import { Bot, Clapperboard, Languages, LayoutDashboard, Tag } from 'lucide-react';
import { SITE, logoSize } from '../shared/content';

export type NavTab = 'translate' | 'feed' | 'dashboard' | 'telegram' | 'pricing';

const TABS: { id: NavTab; label: string; icon: typeof Bot }[] = [
  { id: 'translate', label: 'Translate', icon: Languages },
  { id: 'feed', label: 'Feed', icon: Clapperboard },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'telegram', label: 'Telegram bot', icon: Bot },
  { id: 'pricing', label: 'Pricing', icon: Tag },
];

export function Header({ tab, onTab, account, showPricing = false }: {
  tab: NavTab;
  onTab: (tab: NavTab) => void;
  account?: ReactNode;
  /** Prices only mean something once credits are on. */
  showPricing?: boolean;
}) {
  return (
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
          <span className="hidden sm:inline text-lg font-extrabold tracking-[0.14em] text-slate-100">{SITE.brand.name}</span>
        </button>
        <nav className="flex items-center gap-0.5 sm:gap-1 text-sm min-w-0">
          {TABS.filter((t) => t.id !== 'pricing' || showPricing).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              onClick={() => onTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg transition-colors ${
                tab === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              {/* Phones show icons only (the current tab is highlighted), so the header always fits. */}
              <span className={tab === id ? 'hidden min-[400px]:inline' : 'hidden sm:inline'}>{label}</span>
            </button>
          ))}
          {account}
        </nav>
      </div>
    </header>
  );
}
