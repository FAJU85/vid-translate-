import type { ReactNode } from 'react';
import { Bot, History, Languages, Tag } from 'lucide-react';
import { SITE } from '../shared/content';

export type NavTab = 'translate' | 'history' | 'telegram' | 'pricing';

const TABS: { id: NavTab; label: string; icon: typeof Bot }[] = [
  { id: 'translate', label: 'Translate', icon: Languages },
  { id: 'history', label: 'My translations', icon: History },
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
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur border-b border-slate-800">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <button onClick={() => onTab('translate')} className="flex items-center gap-2 text-lg font-bold text-white shrink-0">
          {SITE.brand.logo ? (
            <img src={SITE.brand.logo} alt={SITE.brand.name} className="h-8 w-auto max-w-[9rem] object-contain" />
          ) : (
            SITE.brand.mark && <span className="text-amber-400">{SITE.brand.mark}</span>
          )}
          <span className="hidden sm:inline">{SITE.brand.name}</span>
        </button>
        <nav className="flex items-center gap-1 text-sm">
          {TABS.filter((t) => t.id !== 'pricing' || showPricing).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                tab === id ? 'bg-amber-400 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className={tab === id ? '' : 'hidden sm:inline'}>{label}</span>
            </button>
          ))}
          {account}
        </nav>
      </div>
    </header>
  );
}
