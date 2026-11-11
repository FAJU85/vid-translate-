import { Bot, History, Languages } from 'lucide-react';

export type NavTab = 'translate' | 'history' | 'telegram';

const TABS: { id: NavTab; label: string; icon: typeof Bot }[] = [
  { id: 'translate', label: 'Translate', icon: Languages },
  { id: 'history', label: 'My translations', icon: History },
  { id: 'telegram', label: 'Telegram bot', icon: Bot },
];

export function Header({ tab, onTab }: { tab: NavTab; onTab: (tab: NavTab) => void }) {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur border-b border-slate-800">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <button onClick={() => onTab('translate')} className="flex items-center gap-2 text-lg font-bold text-white shrink-0">
          <span className="text-amber-400">ترجم</span>
          <span className="hidden sm:inline">TarjimVideo</span>
        </button>
        <nav className="flex items-center gap-1 text-sm">
          {TABS.map(({ id, label, icon: Icon }) => (
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
        </nav>
      </div>
    </header>
  );
}
