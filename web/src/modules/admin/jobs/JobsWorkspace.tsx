import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  BookmarkPlus,
  CalendarDays,
  Columns3,
  Command as CommandIcon,
  ExternalLink,
  Filter as FilterIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Settings,
  SquareCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { AdminAction, AdminJob, JobStatus } from '../../../shared/api';
import { Board, type CardProps } from './Board';
import { BulkBar } from './BulkBar';
import { Calendar } from './Calendar';
import { CommandPalette, type Command } from './CommandPalette';
import { Drawer } from './Drawer';
import {
  ACTION_LABEL,
  BUILT_IN_PRESETS,
  COLUMNS,
  EMPTY_FILTER,
  STATUS_STYLE,
  applyFilter,
  canDo,
  jobTitle,
  sameFilter,
  type Filter,
  type Preset,
} from './model';
import { Table } from './Table';
import { Toasts, useToasts } from './Toasts';
import { useJobs } from './useJobs';

type View = 'board' | 'table' | 'calendar';
const VIEWS: { id: View; label: string; icon: typeof Columns3; key: string }[] = [
  { id: 'board', label: 'Board', icon: Columns3, key: '1' },
  { id: 'table', label: 'Table', icon: Rows3, key: '2' },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays, key: '3' },
];

const VIEW_KEY = 'tarjim_admin_view';
const PRESETS_KEY = 'tarjim_admin_presets';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the choice lasts until the page closes */
  }
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export function JobsWorkspace({ password, onSettings }: { password: string; onSettings: () => void }) {
  const { toasts, notify, dismiss } = useToasts();
  const { jobs, byId, loading, error, loadedAt, refresh, run, pendingIds } = useJobs(password, notify);

  const [view, setViewState] = useState<View>(() => {
    const v = load<View>(VIEW_KEY, 'board');
    return VIEWS.some((x) => x.id === v) ? v : 'board';
  });
  const setView = (v: View) => {
    setViewState(v);
    save(VIEW_KEY, v);
  };
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [presets, setPresets] = useState<Preset[]>(() => load<Preset[]>(PRESETS_KEY, []).filter((p) => p && p.filter));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [tableOrder, setTableOrder] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const visible = useMemo(() => applyFilter(jobs, filter), [jobs, filter]);
  const columns = useMemo(() => {
    const out = Object.fromEntries(COLUMNS.map((c) => [c.status, [] as AdminJob[]])) as Record<JobStatus, AdminJob[]>;
    for (const job of visible) out[job.status]?.push(job);
    return out;
  }, [visible]);

  // A retried job gets a new id: follow it, and forget selections of jobs that are gone.
  useEffect(() => {
    setSelected((s) => {
      const kept = new Set([...s].filter((id) => byId.has(id)));
      return kept.size === s.size ? s : kept;
    });
    if (openId && !byId.has(openId)) setOpenId(null);
    if (focusedId && !byId.has(focusedId)) setFocusedId(null);
  }, [byId, openId, focusedId]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cardProps: CardProps = {
    selected,
    focusedId,
    pending: pendingIds,
    onOpen: (id) => {
      setOpenId(id);
      setFocusedId(id);
    },
    onToggle: toggle,
    onFocus: setFocusedId,
  };

  /** Run an action on the selection, else the open job, else the focused one. */
  const act = useCallback(
    (action: AdminAction, explicit?: string[]) => {
      const ids = explicit ?? (selected.size ? [...selected] : openId ? [openId] : focusedId ? [focusedId] : []);
      const fitting = ids.filter((id) => {
        const job = byId.get(id);
        return job && canDo(action, job);
      });
      if (!fitting.length) {
        if (ids.length) notify({ kind: 'info', text: `${ACTION_LABEL[action].verb} does not apply to ${ids.length === 1 ? 'this job' : 'these jobs'}.` });
        return;
      }
      if (action === 'delete' && !confirm(`Delete ${fitting.length} job${fitting.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
      run(action, fitting);
      if (selected.size) setSelected(new Set());
    },
    [selected, openId, focusedId, byId, run, notify],
  );

  // ---------------------------------------------------------------- keyboard

  /** The order arrow keys move through: columns on the board, rows in the table, days in the calendar. */
  const layout = useMemo<string[][]>(() => {
    if (view === 'board') return COLUMNS.map((c) => columns[c.status].map((j) => j.id));
    if (view === 'table') return [tableOrder];
    return [[...visible].sort((a, b) => a.created_at - b.created_at).map((j) => j.id)];
  }, [view, columns, tableOrder, visible]);

  const moveFocus = useCallback(
    (dx: number, dy: number) => {
      let col = layout.findIndex((ids) => focusedId != null && ids.includes(focusedId));
      let row = col >= 0 ? layout[col].indexOf(focusedId!) : -1;
      if (col < 0) {
        col = layout.findIndex((ids) => ids.length);
        row = 0;
        if (col < 0) return;
      } else if (dx) {
        let next = col + dx;
        while (next >= 0 && next < layout.length && !layout[next].length) next += dx;
        if (next < 0 || next >= layout.length) return;
        col = next;
        row = Math.min(row, layout[col].length - 1);
      } else {
        row = Math.max(0, Math.min(layout[col].length - 1, row + dy));
      }
      const id = layout[col][row];
      setFocusedId(id);
      if (openId) setOpenId(id); // the drawer follows the focus
      // Wait for the virtual list to render the row, then move real focus for screen readers.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-job="${id}"]`)?.focus({ preventScroll: true })),
      );
    },
    [layout, focusedId, openId],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (palette || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (typing(e.target)) (e.target as HTMLElement).blur();
        else if (openId) setOpenId(null);
        else if (selected.size) setSelected(new Set());
        else setFocusedId(null);
        return;
      }
      if (typing(e.target) || e.altKey) return;
      // While a card is being moved with the keyboard, its keys belong to the drag.
      if (dragging.current) return;
      // Enter on a real button or link (a checkbox, a download) keeps its own meaning.
      const el = e.target as HTMLElement | null;
      if (e.key === 'Enter' && el && ['BUTTON', 'A'].includes(el.tagName) && !el.dataset.job) return;
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(visible.map((j) => j.id)));
        return;
      }
      if (mod) return;
      const keys: Record<string, () => void> = {
        '/': () => searchRef.current?.focus(),
        '1': () => setView('board'),
        '2': () => setView('table'),
        '3': () => setView('calendar'),
        ArrowDown: () => moveFocus(0, 1),
        j: () => moveFocus(0, 1),
        ArrowUp: () => moveFocus(0, -1),
        k: () => moveFocus(0, -1),
        ArrowRight: () => moveFocus(1, 0),
        l: () => moveFocus(1, 0),
        ArrowLeft: () => moveFocus(-1, 0),
        h: () => moveFocus(-1, 0),
        Enter: () => focusedId && setOpenId(focusedId),
        o: () => focusedId && setOpenId(focusedId),
        x: () => focusedId && toggle(focusedId),
        c: () => act('cancel'),
        r: () => act('retry'),
        Delete: () => act('delete'),
        Backspace: () => act('delete'),
        n: () => window.open('/', '_blank'),
      };
      const handler = keys[e.key];
      if (handler) {
        e.preventDefault();
        handler();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, openId, selected, focusedId, visible, moveFocus, toggle, act]);

  // ---------------------------------------------------------------- presets

  const activePreset = [...BUILT_IN_PRESETS, ...presets].find((p) => sameFilter(p.filter, filter));
  function savePreset() {
    const name = prompt('Name this view', filter.q || 'My view')?.trim();
    if (!name) return;
    const next = [...presets, { id: crypto.randomUUID(), name: name.slice(0, 40), filter }];
    setPresets(next);
    save(PRESETS_KEY, next);
    notify({ kind: 'success', text: `Saved “${name}”.` });
  }
  function removePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    save(PRESETS_KEY, next);
  }

  // ---------------------------------------------------------------- command palette

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      ...VIEWS.map((v) => ({ id: `view-${v.id}`, group: 'Views', label: `Show ${v.label.toLowerCase()}`, icon: <v.icon className="w-4 h-4" />, shortcut: v.key, run: () => setView(v.id) })),
      ...[...BUILT_IN_PRESETS, ...presets].map((p) => ({
        id: `preset-${p.id}`,
        group: 'Filters',
        label: `Filter: ${p.name}`,
        icon: <FilterIcon className="w-4 h-4" />,
        run: () => setFilter(p.filter),
      })),
      { id: 'search', group: 'Actions', label: 'Search jobs', icon: <Search className="w-4 h-4" />, shortcut: '/', run: () => searchRef.current?.focus() },
      { id: 'select-all', group: 'Actions', label: 'Select every visible job', icon: <SquareCheck className="w-4 h-4" />, shortcut: `${MOD} A`, run: () => setSelected(new Set(visible.map((j) => j.id))) },
      { id: 'cancel', group: 'Actions', label: 'Cancel selected or focused job', icon: <Ban className="w-4 h-4" />, shortcut: 'C', run: () => act('cancel') },
      { id: 'retry', group: 'Actions', label: 'Retry selected or focused job', icon: <RotateCcw className="w-4 h-4" />, shortcut: 'R', run: () => act('retry') },
      { id: 'delete', group: 'Actions', label: 'Delete selected or focused job', icon: <Trash2 className="w-4 h-4" />, shortcut: 'Del', run: () => act('delete') },
      { id: 'retry-failed', group: 'Actions', label: 'Retry every failed job', icon: <RotateCcw className="w-4 h-4" />, run: () => act('retry', jobs.filter((j) => j.status === 'failed').map((j) => j.id)) },
      { id: 'refresh', group: 'Actions', label: 'Refresh now', icon: <RefreshCw className="w-4 h-4" />, run: refresh },
      { id: 'new', group: 'Actions', label: 'New translation (opens the website)', icon: <ExternalLink className="w-4 h-4" />, shortcut: 'N', run: () => window.open('/', '_blank') },
      { id: 'settings', group: 'Go to', label: 'Settings: name, logo, colour, texts', icon: <Settings className="w-4 h-4" />, run: onSettings },
    ];
    for (const job of jobs.slice(0, 300)) {
      list.push({
        id: `job-${job.id}`,
        group: 'Jobs',
        label: jobTitle(job),
        keywords: `${job.id} ${job.source ?? ''} ${job.tgt_lang} ${STATUS_STYLE[job.status].label}`,
        icon: <span className={`w-2 h-2 rounded-full ${STATUS_STYLE[job.status].dot}`} />,
        run: () => {
          setOpenId(job.id);
          setFocusedId(job.id);
        },
      });
    }
    return list;
  }, [presets, visible, jobs, act, refresh, onSettings]);

  // ---------------------------------------------------------------- render

  const openJob = openId ? byId.get(openId) ?? null : null;
  const selectedJobs = [...selected].map((id) => byId.get(id)).filter((j): j is AdminJob => !!j);
  const counts = { active: jobs.filter((j) => j.status === 'queued' || j.status === 'running').length, failed: jobs.filter((j) => j.status === 'failed').length };

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* Sticky control bar: search, saved filters, views. */}
      <div className="shrink-0 sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              ref={searchRef}
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="Search title, link, language, id…"
              aria-label="Search jobs"
              className="w-full h-9 pl-9 pr-8 text-sm bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {filter.q ? (
              <button onClick={() => setFilter((f) => ({ ...f, q: '' }))} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            ) : (
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border border-slate-700 rounded px-1">/</kbd>
            )}
          </div>
          <select
            value={filter.channel}
            onChange={(e) => setFilter((f) => ({ ...f, channel: e.target.value as Filter['channel'] }))}
            aria-label="Channel"
            className="h-9 px-2 text-sm bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
          >
            <option value="all">All channels</option>
            <option value="web">Website</option>
            <option value="telegram">Telegram</option>
          </select>
          <select
            value={filter.range}
            onChange={(e) => setFilter((f) => ({ ...f, range: e.target.value as Filter['range'] }))}
            aria-label="Time range"
            className="h-9 px-2 text-sm bg-slate-900 border border-slate-800 rounded-lg text-slate-200"
          >
            <option value="all">Last 30 days</option>
            <option value="7d">Last 7 days</option>
            <option value="24h">Last 24 hours</option>
          </select>

          <div role="tablist" aria-label="View" className="ml-auto inline-flex p-0.5 rounded-lg border border-slate-800 bg-slate-900">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                title={`${v.label} (${v.key})`}
                className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md text-sm ${view === v.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <v.icon className="w-4 h-4" />
                <span className="hidden md:inline">{v.label}</span>
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            title={loadedAt ? `Updated ${new Date(loadedAt).toLocaleTimeString()}; refreshes every 10 s` : 'Refresh'}
            aria-label="Refresh"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setPalette(true)}
            className="hidden sm:inline-flex h-9 items-center gap-1.5 px-2.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:text-white"
          >
            <CommandIcon className="w-3.5 h-3.5" /> {MOD} K
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" aria-label="Saved filters">
          {[...BUILT_IN_PRESETS, ...presets].map((p) => {
            const active = activePreset?.id === p.id;
            const badge = p.id === 'active' ? counts.active : p.id === 'attention' ? counts.failed : 0;
            return (
              <span key={p.id} className="group relative shrink-0">
                <button
                  onClick={() => setFilter(p.filter)}
                  aria-pressed={active}
                  className={`h-7 inline-flex items-center gap-1.5 px-2.5 rounded-full text-xs border ${
                    active ? 'bg-amber-400 border-amber-400 text-slate-950 font-semibold' : 'border-slate-800 text-slate-300 hover:border-slate-600'
                  } ${p.builtIn ? '' : 'pr-6'}`}
                >
                  {p.name}
                  {badge > 0 && (
                    <span className={`tabular-nums px-1.5 rounded-full text-[10px] ${active ? 'bg-slate-950/20' : p.id === 'attention' ? 'bg-status-failed/20 text-status-failed' : 'bg-slate-800'}`}>
                      {badge}
                    </span>
                  )}
                </button>
                {!p.builtIn && (
                  <button
                    onClick={() => removePreset(p.id)}
                    aria-label={`Remove saved filter ${p.name}`}
                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${active ? 'text-slate-900' : 'text-slate-500 hover:text-white'}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          })}
          {!activePreset && (
            <button onClick={savePreset} className="shrink-0 h-7 inline-flex items-center gap-1.5 px-2.5 rounded-full text-xs border border-dashed border-slate-700 text-slate-400 hover:text-white">
              <BookmarkPlus className="w-3.5 h-3.5" /> Save this filter
            </button>
          )}
          <span className="ml-auto shrink-0 pl-2 text-xs text-slate-500 tabular-nums">
            {visible.length} of {jobs.length}
          </span>
        </div>
      </div>

      {/* Main canvas. */}
      <div className="flex-1 min-h-0 p-4">
        {error && !jobs.length ? (
          <div className="p-4 rounded-xl border border-status-failed/40 bg-status-failed/10 text-sm text-rose-100">{error}</div>
        ) : loading && !jobs.length ? (
          <div className="h-full flex items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : view === 'board' ? (
          <Board columns={columns} props={cardProps} run={(a, ids) => act(a, ids)} onRefused={(text) => notify({ kind: 'info', text })}
            onDragging={(d) => (dragging.current = d)}
          />
        ) : view === 'table' ? (
          <Table jobs={visible} props={cardProps} onOrder={setTableOrder} />
        ) : (
          <Calendar jobs={visible} props={cardProps} />
        )}
      </div>

      <BulkBar jobs={selectedJobs} run={(a) => act(a)} clear={() => setSelected(new Set())} />
      <Drawer job={openJob} password={password} busy={!!openJob && pendingIds.has(openJob.id)} run={(a, ids) => act(a, ids)} onClose={() => setOpenId(null)} />
      <CommandPalette open={palette} commands={commands} onClose={() => setPalette(false)} />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
