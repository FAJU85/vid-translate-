import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, BLOCK_ICONS, BLOCK_TABS, BLOCK_TONES, adminApi, type SiteBlock, type SiteBlockButton } from '../../shared/api';
import { BlockBanner, pick } from '../../shared/blocks';

const input = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400';
const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50';
const primary = `${btn} bg-amber-400 hover:bg-amber-300 text-slate-950`;
const quiet = `${btn} border border-slate-700 text-slate-200 hover:bg-slate-800`;
const icon = 'p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40';

const PLACE_NAMES: Record<SiteBlock['place'], string> = {
  top: 'Top of every page',
  translate: 'Top of the Translate page',
  lyrics: 'Top of the Lyrics page',
  feed: 'Top of the Feed',
  telegram: 'Top of the Telegram page',
  dashboard: 'Top of My videos',
  footer: 'Link in the footer',
};
const TAB_NAMES: Record<(typeof BLOCK_TABS)[number], string> = { translate: 'Translate', lyrics: 'Lyrics', feed: 'Feed', telegram: 'Telegram', dashboard: 'My videos' };

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blank = (footer: boolean): SiteBlock => ({
  id: newId(),
  name: footer ? 'New footer link' : 'New banner',
  enabled: false,
  place: footer ? 'footer' : 'top',
  sources: [],
  start: '',
  end: '',
  tone: 'brand',
  icon: footer ? 'none' : 'megaphone',
  title_en: '',
  title_ar: '',
  text_en: '',
  text_ar: '',
  buttons: [],
  dismissible: !footer,
  url: '',
});

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** When and to whom it shows, in a few words. */
function summary(b: SiteBlock): string {
  const parts = [PLACE_NAMES[b.place], b.sources.length ? `only visitors from ${b.sources.join(', ')}` : 'everyone'];
  if (b.start || b.end) parts.push(`${b.start || '…'} to ${b.end || '…'}`);
  return parts.join(' · ');
}

/** What would keep it from showing although it is on. */
function problem(b: SiteBlock): string | null {
  if (b.place === 'footer') return !b.url ? 'No address yet: the link is hidden.' : !(b.text_en || b.text_ar) ? 'No text yet: the link is hidden.' : null;
  if (!(b.title_en || b.title_ar || b.text_en || b.text_ar)) return 'No text yet: the banner is hidden.';
  if (b.buttons.some((x) => !x.tab && !x.url)) return 'A button has no address yet: that button is hidden.';
  return null;
}

function Editor({ b, set }: { b: SiteBlock; set: (patch: Partial<SiteBlock>) => void }) {
  const footer = b.place === 'footer';
  const setButton = (i: number, patch: Partial<SiteBlockButton>) => set({ buttons: b.buttons.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-4 pt-3 border-t border-slate-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name (only you see it)">
          <input className={input} value={b.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Where">
          <select className={input} value={b.place} onChange={(e) => set({ place: e.target.value as SiteBlock['place'] })}>
            {Object.entries(PLACE_NAMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Only visitors from (empty: everyone)" hint="Names from the Growth page, separated by commas: producthunt, instagram-bio… (links with ?ref=name).">
          <input
            className={input}
            dir="ltr"
            value={b.sources.join(', ')}
            onChange={(e) => set({ sources: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) })}
            placeholder="everyone"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day (empty: now)">
            <input type="date" className={input} value={b.start} onChange={(e) => set({ start: e.target.value })} />
          </Field>
          <Field label="Last day (empty: no end)">
            <input type="date" className={input} value={b.end} onChange={(e) => set({ end: e.target.value })} />
          </Field>
        </div>
      </div>

      {footer ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Link text (English)">
            <input className={input} value={b.text_en} maxLength={400} onChange={(e) => set({ text_en: e.target.value })} />
          </Field>
          <Field label="Link text (Arabic)">
            <input className={input} dir="rtl" value={b.text_ar} maxLength={400} onChange={(e) => set({ text_ar: e.target.value })} />
          </Field>
          <Field label="Address" hint="https://… or a page of this site such as /terms">
            <input className={input} dir="ltr" value={b.url} onChange={(e) => set({ url: e.target.value.trim() })} placeholder="https://" />
          </Field>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Colour">
              <select className={input} value={b.tone} onChange={(e) => set({ tone: e.target.value as SiteBlock['tone'] })}>
                {BLOCK_TONES.map((x) => (
                  <option key={x} value={x}>
                    {x === 'producthunt' ? 'Product Hunt orange' : x[0].toUpperCase() + x.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Icon">
              <select className={input} value={b.icon} onChange={(e) => set({ icon: e.target.value as SiteBlock['icon'] })}>
                {BLOCK_ICONS.map((x) => (
                  <option key={x} value={x}>
                    {x === 'none' ? 'No icon' : x[0].toUpperCase() + x.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-200 sm:pt-6">
              <input type="checkbox" checked={b.dismissible} onChange={(e) => set({ dismissible: e.target.checked })} /> Visitors can close it
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bold start (English)" hint="{brand} becomes the site's name.">
              <input className={input} value={b.title_en} maxLength={120} onChange={(e) => set({ title_en: e.target.value })} />
            </Field>
            <Field label="Bold start (Arabic)">
              <input className={input} dir="rtl" value={b.title_ar} maxLength={120} onChange={(e) => set({ title_ar: e.target.value })} />
            </Field>
            <Field label="Text (English)">
              <textarea className={input} rows={2} value={b.text_en} maxLength={400} onChange={(e) => set({ text_en: e.target.value })} />
            </Field>
            <Field label="Text (Arabic)">
              <textarea className={input} rows={2} dir="rtl" value={b.text_ar} maxLength={400} onChange={(e) => set({ text_ar: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-400">Buttons (up to 3)</div>
            {b.buttons.map((x, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1.3fr_auto_auto] items-center p-2 rounded-lg border border-slate-800">
                <input className={input} placeholder="Label (English)" value={x.label_en} maxLength={40} onChange={(e) => setButton(i, { label_en: e.target.value })} />
                <input className={input} placeholder="Label (Arabic)" dir="rtl" value={x.label_ar} maxLength={40} onChange={(e) => setButton(i, { label_ar: e.target.value })} />
                <select
                  className={input}
                  value={x.tab ?? 'url'}
                  onChange={(e) => setButton(i, e.target.value === 'url' ? { tab: undefined, url: x.url ?? '' } : { tab: e.target.value as SiteBlockButton['tab'], url: undefined })}
                >
                  {BLOCK_TABS.map((tab) => (
                    <option key={tab} value={tab}>
                      Opens {TAB_NAMES[tab]}
                    </option>
                  ))}
                  <option value="url">Opens an address</option>
                </select>
                {x.tab ? (
                  <span />
                ) : (
                  <input className={input} dir="ltr" placeholder="https://" value={x.url ?? ''} onChange={(e) => setButton(i, { url: e.target.value.trim() })} />
                )}
                <label className="flex items-center gap-1 text-xs text-slate-300 whitespace-nowrap">
                  <input type="checkbox" checked={Boolean(x.primary)} onChange={(e) => setButton(i, { primary: e.target.checked || undefined })} /> Main
                </label>
                <button type="button" className={icon} aria-label="Remove button" onClick={() => set({ buttons: b.buttons.filter((_, j) => j !== i) })}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {b.buttons.length < 3 && (
              <button type="button" className={quiet} onClick={() => set({ buttons: [...b.buttons, { label_en: '', label_ar: '', tab: 'translate' }] })}>
                <Plus className="w-4 h-4" /> Add a button
              </button>
            )}
          </div>
        </>
      )}

      <div className="space-y-2">
        <div className="text-xs text-slate-400">Preview</div>
        {footer ? (
          <p className="text-xs text-slate-400">
            Footer: … · <span className="underline">{pick(b.text_en, b.text_ar, false) || '(no text)'}</span> · <span dir="rtl" className="underline">{pick(b.text_en, b.text_ar, true) || '(no text)'}</span>
          </p>
        ) : (
          <>
            <BlockBanner block={b} arabic={false} />
            <BlockBanner block={b} arabic />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Banners and footer links: add, edit, duplicate, delete, reorder, turn on and off, limit to
 * dates and to visitors from one place. Nothing changes on the site until Save.
 */
export function BannersPanel({ password }: { password: string }) {
  const [list, setList] = useState<SiteBlock[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    adminApi
      .load(password)
      .then((s) => setList(s.blocks ?? []))
      .catch((err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not load the banners.' }));
  }, [password]);

  const change = (next: SiteBlock[]) => {
    setList(next);
    setDirty(true);
    setMsg(null);
  };
  const update = (id: string, patch: Partial<SiteBlock>) => change(list!.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (i: number, by: number) => {
    const next = [...list!];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    change(next);
  };
  const add = (footer: boolean) => {
    const b = blank(footer);
    change([b, ...list!]);
    setOpen(b.id);
  };
  const duplicate = (i: number) => {
    const copy = { ...structuredClone(list![i]), id: newId(), name: `${list![i].name} (copy)`, enabled: false };
    change([...list!.slice(0, i + 1), copy, ...list!.slice(i + 1)]);
    setOpen(copy.id);
  };
  const remove = (i: number) => {
    if (!window.confirm(`Delete "${list![i].name || 'this banner'}"? It goes after you press Save.`)) return;
    change(list!.filter((_, j) => j !== i));
  };
  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.save(password, { blocks: list! });
      const fresh = await adminApi.load(password);
      setList(fresh.blocks ?? []);
      setDirty(false);
      setMsg({ ok: true, text: 'Saved. Visitors see the change on their next page load.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Banners and links</h1>
          <p className="text-sm text-slate-400">
            Messages at the top of the site or of one page, and extra links in the footer, in English and Arabic. Show one to everyone or only to visitors from one place
            (e.g. Product Hunt), between two dates. Nothing changes on the site until you press Save.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={quiet} disabled={!list} onClick={() => add(false)}>
            <Plus className="w-4 h-4" /> New banner
          </button>
          <button className={quiet} disabled={!list} onClick={() => add(true)}>
            <Plus className="w-4 h-4" /> New footer link
          </button>
          <button className={primary} disabled={!list || !dirty || busy} onClick={save}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
      {dirty && <p className="p-3 text-sm rounded-xl border border-amber-700 bg-amber-950/50 text-amber-100">Unsaved changes: press Save to put them on the site.</p>}
      {msg && <p className={`p-3 text-sm rounded-xl border ${msg.ok ? 'border-emerald-800 bg-emerald-950/60 text-emerald-200' : 'border-rose-800 bg-rose-950/60 text-rose-200'}`}>{msg.text}</p>}
      {!list ? (
        !msg && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-400">No banners or footer links. Add one above.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((b, i) => {
            const issue = b.enabled ? problem(b) : null;
            return (
              <li key={b.id} className="p-4 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer" title={b.enabled ? 'On: visitors see it' : 'Off: hidden'}>
                    <input type="checkbox" className="w-4 h-4 accent-amber-400" checked={b.enabled} onChange={(e) => update(b.id, { enabled: e.target.checked })} />
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${b.enabled ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-700/60 text-slate-300'}`}>{b.enabled ? 'On' : 'Off'}</span>
                  </label>
                  <div className="flex-1 min-w-[12rem]">
                    <div className="font-semibold text-white">{b.name || pick(b.title_en || b.text_en, b.title_ar || b.text_ar, false) || 'Untitled'}</div>
                    <div className="text-xs text-slate-400">{summary(b)}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button className={icon} aria-label="Edit" title="Edit" onClick={() => setOpen(open === b.id ? null : b.id)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className={icon} aria-label="Duplicate" title="Duplicate" onClick={() => duplicate(i)} disabled={list.length >= 30}>
                      <Copy className="w-4 h-4" />
                    </button>
                    <button className={icon} aria-label="Move up" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button className={icon} aria-label="Move down" title="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button className={`${icon} hover:text-rose-300`} aria-label="Delete" title="Delete" onClick={() => remove(i)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {issue && <p className="text-xs text-amber-300">{issue}</p>}
                {open === b.id && <Editor b={b} set={(patch) => update(b.id, patch)} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
