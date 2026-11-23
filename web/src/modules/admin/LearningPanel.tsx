import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { ApiError, adminApi, api, type AppConfig, type MemoryEntry, type MemoryKind } from '../../shared/api';
import { QualityPanel } from './QualityPanel';

const STATUS: Record<MemoryEntry['status'], { label: string; tone: string }> = {
  candidate: { label: 'Waiting', tone: 'bg-slate-700 text-slate-200' },
  learned: { label: 'Learned', tone: 'bg-status-done/15 text-status-done' },
  approved: { label: 'Approved', tone: 'bg-amber-400/15 text-amber-300' },
  rejected: { label: 'Rejected', tone: 'bg-status-failed/15 text-status-failed' },
};
const FILTERS = ['', 'candidate', 'learned', 'approved', 'rejected'] as const;

/**
 * Learning workspace: KAVOX's translation memory. People's corrections become rules once enough
 * different people made the same one; here an admin sees every rule, approves, corrects, rejects
 * or deletes it, and writes glossary terms (names, brands, fixed words) and sentences directly.
 */
export function LearningPanel({ password }: { password: string }) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [votes, setVotes] = useState(3);
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [form, setForm] = useState({ kind: 'term' as MemoryKind, src: 'en', tgt: 'ar', source: '', translation: '', replaces: 0 });

  // Only the latest request may show its answer (filters and searches can overlap).
  const latest = useRef(0);
  const load = () => {
    const request = ++latest.current;
    setBusy(true);
    adminApi
      .memory(password, { status, q })
      .then((r) => {
        if (request !== latest.current) return;
        setEntries(r.entries);
        setCounts(r.counts);
        setVotes(r.learn_votes);
        setError(null);
      })
      .catch((err) => {
        if (request === latest.current) setError(err instanceof ApiError ? err.message : 'Could not load the memory.');
      })
      .finally(() => {
        if (request === latest.current) setBusy(false);
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [status]);
  useEffect(() => void api.config().then(setConfig, () => {}), []);

  const act = (p: Promise<unknown>) => p.then(load).catch((err) => setError(err instanceof ApiError ? err.message : 'That did not work.'));

  function save(e: FormEvent) {
    e.preventDefault();
    const sent = form;
    // Cleared only if it still holds what was sent (another rule may have been picked meanwhile).
    act(adminApi.addMemory(password, { ...sent, replaces: sent.replaces || undefined }).then(() =>
      setForm((f) => (f === sent ? { ...f, source: '', translation: '', replaces: 0 } : f)),
    ));
  }

  const langs = config?.languages ?? [];
  const select = (value: string, set: (v: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => set(e.target.value)} className="px-2 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white">
      {(langs.length ? langs : [{ code: value, en: value }]).map((l) => (
        <option key={l.code} value={l.code}>
          {l.en}
        </option>
      ))}
    </select>
  );

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Learning</h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            KAVOX's translation memory: rules, not AI. When {votes} different signed-in people make the same correction to a
            translation, it is learned and used for everyone; your approval makes it count at once. Glossary terms (names, brands,
            fixed words) are always translated as you write them. Speech fixes correct words the speech recognition keeps
            mishearing, before anything is translated. Pronunciations tell the dubbing voice how to say a word (with diacritics,
            or spelled as it sounds); the subtitles keep the word as written. These rules are applied before the models.
          </p>
        </div>
        <button onClick={load} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800">
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <form onSubmit={save} className="p-4 rounded-xl border border-slate-800 bg-slate-900 space-y-3">
        <div className="text-sm font-semibold text-white">{form.replaces ? 'Correct this rule' : 'Add a rule'}</div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MemoryKind })} className="px-2 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white">
            <option value="term">Glossary term</option>
            <option value="sentence">Sentence</option>
            <option value="fix">Speech fix</option>
            <option value="say">Pronunciation (dubbing)</option>
          </select>
          {select(form.src, (src) => setForm({ ...form, src }), form.kind === 'fix' ? 'Spoken language' : form.kind === 'say' ? 'Language' : 'From')}
          {form.kind !== 'fix' && form.kind !== 'say' && (
            <>
              <span className="self-center text-slate-500">→</span>
              {select(form.tgt, (tgt) => setForm({ ...form, tgt }), 'Into')}
            </>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <input required dir="auto" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder={form.kind === 'term' ? 'Term as spoken, e.g. KAVOX' : form.kind === 'fix' ? 'Words as misheard, e.g. Cavox' : form.kind === 'say' ? 'Word as written, e.g. علم' : 'Sentence as spoken'} className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white" />
          <input required dir="auto" value={form.translation} onChange={(e) => setForm({ ...form, translation: e.target.value })} placeholder={form.kind === 'fix' ? 'What was really said, e.g. KAVOX' : form.kind === 'say' ? 'How to say it, e.g. عَلَم' : 'Its translation, e.g. كافوكس'} className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white" />
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-sm font-semibold text-slate-950">
            <Plus className="w-4 h-4" /> {form.replaces ? 'Save correction' : 'Add and approve'}
          </button>
          {form.replaces ? (
            <button type="button" onClick={() => setForm({ ...form, source: '', translation: '', replaces: 0 })} className="px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white">
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setStatus(f)}
            className={`px-3 py-1.5 rounded-lg text-sm ${status === f ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            {f ? STATUS[f].label : 'All'}
            <span className="ml-1 text-slate-500 tabular-nums">{f ? counts[f] ?? 0 : Object.values(counts).reduce((a, b) => a + b, 0)}</span>
          </button>
        ))}
        <form onSubmit={(e) => (e.preventDefault(), load())} className="ml-auto">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white" />
        </form>
      </div>

      {error && <p className="p-3 rounded-lg border border-rose-800 bg-rose-950/60 text-sm text-rose-200">{error}</p>}
      {!entries && !error && <Loader2 className="w-5 h-5 animate-spin text-slate-500" />}
      {entries && entries.length === 0 && (
        <p className="text-sm text-slate-400">
          Nothing here yet. Rules appear as people correct translations in the subtitle editor, or when you add them above.
        </p>
      )}
      {entries && entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Spoken</th>
                <th className="px-3 py-2 font-medium">Translation</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">People</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2 text-slate-200" dir="auto">
                    <span className="block text-[11px] text-slate-500">
                      {e.kind === 'fix' ? `Speech fix · ${e.src}` : e.kind === 'say' ? `Pronunciation · ${e.src}` : `${e.kind === 'term' ? 'Term' : 'Sentence'} · ${e.src} → ${e.tgt}`}
                    </span>
                    {e.source}
                  </td>
                  <td className="px-3 py-2 text-white" dir="auto">{e.translation}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{e.votes}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {e.status !== 'approved' && (
                        <button title="Approve" aria-label="Approve" onClick={() => act(adminApi.judgeMemory(password, e.id, 'approved'))} className="p-1.5 rounded-md text-emerald-400 hover:bg-slate-800">
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        title="Correct"
                        aria-label="Correct"
                        onClick={() => setForm({ kind: e.kind, src: e.src, tgt: e.tgt, source: e.source, translation: e.translation, replaces: e.id })}
                        className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {e.status !== 'rejected' && (
                        <button title="Reject" aria-label="Reject" onClick={() => act(adminApi.judgeMemory(password, e.id, 'rejected'))} className="p-1.5 rounded-md text-rose-300 hover:bg-slate-800">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      <button title="Delete" aria-label="Delete" onClick={() => window.confirm('Delete this rule?') && act(adminApi.deleteMemory(password, e.id))} className="p-1.5 rounded-md text-slate-500 hover:text-rose-300 hover:bg-slate-800">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QualityPanel password={password} />
    </div>
  );
}
