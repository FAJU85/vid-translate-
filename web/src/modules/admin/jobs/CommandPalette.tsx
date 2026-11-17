import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  /** Extra words the search should match. */
  keywords?: string;
  run: () => void;
}

/** Cmd/Ctrl+K: type to find any command or job, arrows to choose, Enter to run. */
export function CommandPalette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = commands.filter((c) => {
      const hay = `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return found.slice(0, 50);
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-black/50" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(matches[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Type a command or search jobs…"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={matches[index] ? `palette-${matches[index].id}` : undefined}
            className="flex-1 h-12 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          <kbd className="text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div ref={list} id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-2">
          {matches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing found.</p>}
          {matches.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{header}</div>}
                <div
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(c)}
                  className={`mx-2 flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer ${i === index ? 'bg-slate-800 text-white' : 'text-slate-300'}`}
                >
                  <span className="w-4 h-4 text-slate-400 flex items-center justify-center">{c.icon}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.shortcut && <kbd className="text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">{c.shortcut}</kbd>}
                  {i === index && <CornerDownLeft className="w-3.5 h-3.5 text-slate-500" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
