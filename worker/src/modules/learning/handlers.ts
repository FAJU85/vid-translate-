import { apiError, json } from '../../shared/http';
import type { Env } from '../../shared/env';
import { ENTRY_KINDS, LEARN_VOTES, counts, deleteEntry, getEntry, listEntries, saveByAdmin, setStatus, type EntryKind } from './store';
const LANG = /^[a-z]{2,3}$/;

/**
 * /api/admin/memory: the rules KAVOX learned (or an admin wrote), to review, approve, correct,
 * reject or add. The caller has already checked the admin password.
 */
export async function handleMemoryAdmin(request: Request, env: Env, path: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (path === '/api/admin/memory' && request.method === 'GET') {
    const entries = await listEntries(env, {
      status: url.searchParams.get('status') || undefined,
      tgt: url.searchParams.get('tgt') || undefined,
      q: url.searchParams.get('q')?.trim() || undefined,
    });
    return json({ entries, counts: await counts(env), learn_votes: LEARN_VOTES });
  }
  if (path === '/api/admin/memory' && request.method === 'POST') {
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = String(b?.kind ?? '') as EntryKind;
    const [src, rawTgt, source, translation] = ['src', 'tgt', 'source', 'translation'].map((k) => String(b?.[k] ?? '').trim());
    // A speech fix stays in the spoken language: "these words were really those".
    const tgt = kind === 'fix' ? src : rawTgt;
    const sameLang = kind !== 'fix' && src === tgt;
    if (!ENTRY_KINDS.includes(kind) || !LANG.test(src) || !LANG.test(tgt) || sameLang || !source || !translation) {
      return apiError(400, 'E_BAD_REQUEST', 'Give the kind, both languages, the text and its translation.');
    }
    if (source.length > 500 || translation.length > 500) return apiError(400, 'E_BAD_REQUEST', 'Keep entries under 500 characters.');
    const id = await saveByAdmin(env, { kind, src, tgt, source, translation });
    // Editing an entry: the old wording is retired.
    const replaces = Number(b?.replaces);
    if (id && replaces && replaces !== id) await setStatus(env, replaces, 'rejected');
    return json({ id }, 201);
  }
  const m = path.match(/^\/api\/admin\/memory\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (!(await getEntry(env, id))) return apiError(404, 'E_NOT_FOUND', 'No such entry.');
    if (request.method === 'DELETE') {
      await deleteEntry(env, id);
      return json({ ok: true });
    }
    if (request.method === 'POST') {
      const status = String(((await request.json().catch(() => null)) as { status?: string } | null)?.status ?? '');
      if (status !== 'approved' && status !== 'rejected') return apiError(400, 'E_BAD_REQUEST', 'Approve or reject.');
      await setStatus(env, id, status);
      return json({ ok: true });
    }
  }
  return null;
}
