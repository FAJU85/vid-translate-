import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { ApiError, adminApi, type AdminAccount, type Bucket } from '../../shared/api';
import { creditsText } from '../account';

const BUCKETS: [Bucket, string][] = [
  ['topup', 'Bought (never expires)'],
  ['bonus', 'Bonus'],
  ['monthly', 'Monthly plan'],
  ['daily', 'Free today'],
];

const ago = (ts?: number) => {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

/** /admin → Accounts: find someone and add (or take away) credits. */
export function AccountsPanel({ password }: { password: string }) {
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminAccount | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      adminApi.accounts(password, query).then(setAccounts, (e) => setError(e instanceof ApiError ? e.message : 'Could not load accounts.'));
    }, 250);
    return () => clearTimeout(timer);
  }, [password, query]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Accounts</h1>
        <p className="text-sm text-slate-400">People who signed in on the website or used the bot. 1 credit = 60 seconds of video.</p>
      </div>
      <label className="relative block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or Telegram id"
          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-slate-950 border border-slate-800 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </label>
      {error && <p className="p-3 rounded-lg border border-rose-800 bg-rose-950/60 text-sm text-rose-200">{error}</p>}
      {!accounts ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
      ) : accounts.length === 0 ? (
        <p className="text-sm text-slate-500">No accounts{query ? ' match' : ' yet'}.</p>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium hidden md:table-cell">Signs in with</th>
                <th className="px-3 py-2 font-medium text-right">Credits</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell text-right">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {accounts.map((a) => (
                <tr key={a.id} onClick={() => setOpen(a)} className="cursor-pointer hover:bg-slate-900/70">
                  <td className="px-3 py-2">
                    <div className="text-slate-100">{a.name || a.email || 'Unnamed'}</div>
                    {a.email && <div className="text-xs text-slate-500">{a.email}</div>}
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-slate-400">
                    {[a.linked.telegram && `Telegram ${a.telegram_id ?? ''}`, a.linked.google && 'Google', a.linked.email && 'Email'].filter(Boolean).join(' · ')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-100">{creditsText(a.balance.total_seconds)}</td>
                  <td className="px-3 py-2 hidden sm:table-cell text-right text-slate-500">{ago(a.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <AccountDrawer
          password={password}
          account={open}
          onClose={() => setOpen(null)}
          onChanged={(a) => {
            setOpen(a);
            setAccounts((list) => list?.map((x) => (x.id === a.id ? { ...x, ...a } : x)) ?? list);
          }}
        />
      )}
    </div>
  );
}

function AccountDrawer({ password, account, onClose, onChanged }: {
  password: string;
  account: AdminAccount;
  onClose: () => void;
  onChanged: (a: AdminAccount) => void;
}) {
  const [detail, setDetail] = useState<AdminAccount | null>(null);
  const [amount, setAmount] = useState('10');
  const [bucket, setBucket] = useState<Bucket>('topup');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.account(password, account.id).then(setDetail, () => {});
  }, [password, account.id]);

  async function grant(e: FormEvent, sign: 1 | -1) {
    e.preventDefault();
    const credits = Number(amount);
    if (!(credits > 0)) return setError('Enter a number of credits above 0.');
    setBusy(true);
    setError(null);
    try {
      const expires = bucket === 'monthly' || bucket === 'daily' ? Number(days) || undefined : undefined;
      const res = await adminApi.grant(password, account.id, { seconds: sign * Math.round(credits * 60), bucket, days: expires, note });
      setDetail(res);
      onChanged({ ...account, ...res });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the credits.');
    } finally {
      setBusy(false);
    }
  }

  const shown = detail ?? account;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-full sm:w-[28rem] h-full overflow-y-auto bg-slate-900 border-l border-slate-800 p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">{shown.name || shown.email || 'Unnamed'}</h2>
            <p className="text-xs text-slate-500">{shown.email}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-950">
          <div className="text-2xl font-bold text-white tabular-nums">{creditsText(shown.balance.total_seconds)} credits</div>
          <div className="mt-1 text-xs text-slate-400">
            {shown.balance.buckets.filter((b) => b.seconds).map((b) => `${b.bucket} ${creditsText(b.seconds)}`).join(' · ') || 'Empty'}
          </div>
        </div>
        <form className="space-y-3" onSubmit={(e) => grant(e, 1)}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Add or remove credits</h3>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Credits"
              className="px-3 py-2 text-sm rounded-lg bg-slate-950 border border-slate-700 text-white"
            />
            <select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)} className="px-3 py-2 text-sm rounded-lg bg-slate-950 border border-slate-700 text-white">
              {BUCKETS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {(bucket === 'monthly' || bucket === 'daily') && (
            <label className="block text-xs text-slate-400">
              Expires after
              <input
                type="number"
                min="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="mx-2 w-20 px-2 py-1 text-sm rounded-lg bg-slate-950 border border-slate-700 text-white"
              />
              days
            </label>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional), e.g. refund for a broken video"
            className="w-full px-3 py-2 text-sm rounded-lg bg-slate-950 border border-slate-700 text-white placeholder:text-slate-600"
          />
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-sm font-semibold text-slate-950 disabled:opacity-50">
              Add
            </button>
            <button type="button" disabled={busy} onClick={(e) => grant(e, -1)} className="px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
              Remove
            </button>
          </div>
        </form>
        {detail?.history && detail.history.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">History</h3>
            <ul className="divide-y divide-slate-800 text-sm">
              {detail.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-300">
                    {h.kind}
                    {h.detail && <span className="text-slate-500"> · {h.detail}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-200">
                    {h.seconds >= 0 ? '+' : '−'}
                    {creditsText(Math.abs(h.seconds))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
