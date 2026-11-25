import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { ApiError, adminApi, type AuditItem } from '../../shared/api';

const FILTERS: [string, string][] = [
  ['', 'Everything'],
  ['admin.login', 'Admin sign-ins'],
  ['admin.', 'Admin actions'],
  ['data.export', 'Data downloads'],
  ['account.delete', 'Account deletions'],
  ['video.delete', 'Video deletions'],
];

const LABEL: Record<string, string> = {
  'admin.login': 'Admin signed in',
  'admin.login_failed': 'Admin sign-in failed',
  'admin.post': 'Admin change',
  'admin.delete': 'Admin deletion',
  'admin.view_account': 'Admin opened an account',
  'data.export': 'Someone downloaded their data',
  'account.delete': 'An account was deleted',
  'video.delete': 'A video was deleted by its owner',
};

const when = (sec: number) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

/**
 * Audit log workspace: who did what to sensitive data, newest first (kept a year). Failed admin
 * sign-ins stand out; "conn" is a fingerprint of the connection, never its address.
 */
export function AuditPanel({ password }: { password: string }) {
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<AuditItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request counts: an answer for a filter no longer chosen is dropped.
  const latest = useRef(0);

  const load = (before: number | null) => {
    const id = ++latest.current;
    setLoading(true);
    adminApi
      .audit(password, filter, before)
      .then((r) => {
        if (id !== latest.current) return;
        setItems((prev) => (before ? [...prev, ...r.items] : r.items));
        setNext(r.next);
        setError(null);
      })
      .catch((err) => {
        if (id === latest.current) setError(err instanceof ApiError ? err.message : 'Could not load the audit log.');
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  };
  useEffect(() => load(null), [password, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Audit log</h1>
          <p className="text-sm text-slate-400">Admin sign-ins and changes, and people downloading or deleting their data. Kept for one year.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show" className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200">
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button onClick={() => load(null)} aria-label="Refresh" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400 text-xs">
            <tr>
              <th className="text-start font-medium px-3 py-2">When</th>
              <th className="text-start font-medium px-3 py-2">What</th>
              <th className="text-start font-medium px-3 py-2">On</th>
              <th className="text-start font-medium px-3 py-2">Details</th>
              <th className="text-start font-medium px-3 py-2">Connection</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((a) => (
              <tr key={a.id} className={a.action === 'admin.login_failed' ? 'bg-rose-950/30' : ''}>
                <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums">{when(a.at)}</td>
                <td className="px-3 py-2 text-slate-100">
                  {LABEL[a.action] ?? a.action}
                  <span className="block text-[11px] text-slate-500">{a.actor}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300 break-all">{a.target ?? ''}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400 break-all max-w-xs">{a.detail ?? ''}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{a.conn ?? ''}</td>
              </tr>
            ))}
            {!loading && !items.length && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                  Nothing logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {next && (
        <button onClick={() => load(next)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800">
          Older
        </button>
      )}
    </div>
  );
}
