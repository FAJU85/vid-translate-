import { json } from '../../shared/http';
import { now, type Env } from '../../shared/env';
import type { JobRow, OutroChoice } from '../jobs';
import { getAccount, type Account } from './store';

/**
 * The ending (outro) added to every rendered video: the KAVOX clip by default. Subscribers to a
 * monthly plan may use their own clip (kept in R2) or none at all.
 */
export type OutroMode = 'kavox' | 'custom' | 'none';
export const OUTRO_MODES: OutroMode[] = ['kavox', 'custom', 'none'];
export const OUTRO_MAX_BYTES = 30 * 1024 * 1024;
/** What the Space keeps of a longer clip (backend media.OUTRO_MAX_SECONDS). */
export const OUTRO_MAX_SECONDS = 30;

const fileKey = (accountId: string) => `outros/${accountId}`;

/** A monthly plan that is still running (its credits may be used up: it is still a subscription). */
export async function hasPlan(env: Env, accountId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM credit_buckets WHERE account_id = ? AND bucket = 'monthly' AND expires_at > ?")
    .bind(accountId, now())
    .first();
  return Boolean(row);
}

/** What the account panel shows about the ending. */
export async function outroInfo(env: Env, account: Account) {
  const plan = await hasPlan(env, account.id);
  return {
    mode: (plan ? account.outro ?? 'kavox' : 'kavox') as OutroMode,
    custom: Boolean(account.outro_size),
    allowed: plan,
    storage: Boolean(env.MEDIA),
    max_mb: OUTRO_MAX_BYTES / 1024 / 1024,
    max_seconds: OUTRO_MAX_SECONDS,
  };
}

/**
 * The account behind a job: the one recorded when it was made (signed in, or the bot user's), else
 * the one its credits were set aside from (a guest's), else the original job's for a re-render.
 */
async function jobAccount(env: Env, job: JobRow): Promise<Account | null> {
  if (job.account_id) return getAccount(env, job.account_id);
  const ids = job.source_kind === 'rerender' ? [job.id, job.source] : [job.id];
  for (const id of ids) {
    const hold = await env.DB.prepare('SELECT account_id FROM credit_holds WHERE job_id = ?').bind(id).first<{ account_id: string }>();
    if (hold) return getAccount(env, hold.account_id);
  }
  return null;
}

/** Jobs brick port: which ending a job's video gets (the KAVOX one unless a subscriber chose). */
export async function chooseOutro(env: Env, job: JobRow): Promise<OutroChoice> {
  const account = await jobAccount(env, job);
  if (!account || !account.outro || account.outro === 'kavox' || !(await hasPlan(env, account.id))) return { kind: 'kavox' };
  if (account.outro === 'none') return { kind: 'none' };
  const file = env.MEDIA ? await env.MEDIA.get(fileKey(account.id)) : null;
  return file ? { kind: 'custom', file: { body: file.body, length: file.size } } : { kind: 'kavox' };
}

const setMode = (env: Env, accountId: string, mode: OutroMode, size?: number | null) =>
  env.DB.prepare(`UPDATE accounts SET outro = ?${size === undefined ? '' : ', outro_size = ?'} WHERE id = ?`)
    .bind(...(size === undefined ? [mode, accountId] : [mode, size, accountId]))
    .run();

const refuse = (status: number, code: string, message: string) => json({ error_code: code, message }, status);

/** /api/account/outro (POST {mode}) and /api/account/outro/file (PUT, GET, DELETE). */
export async function handleOutro(env: Env, request: Request, account: Account, path: string): Promise<Response> {
  const method = request.method;
  const plan = await hasPlan(env, account.id);
  if (path === '/api/account/outro' && method === 'POST') {
    const mode = String(((await request.json().catch(() => null)) as { mode?: string } | null)?.mode ?? '');
    if (!OUTRO_MODES.includes(mode as OutroMode)) return refuse(400, 'E_BAD_REQUEST', 'Choose kavox, custom or none.');
    if (mode !== 'kavox' && !plan) return refuse(402, 'E_PLAN_NEEDED', 'Your own ending, or none, comes with a monthly plan.');
    if (mode === 'custom' && !account.outro_size) return refuse(400, 'E_BAD_REQUEST', 'Upload your ending first.');
    await setMode(env, account.id, mode as OutroMode);
    return json(await outroInfo(env, { ...account, outro: mode as OutroMode }));
  }
  if (path !== '/api/account/outro/file') return refuse(404, 'E_NOT_FOUND', 'Not found.');
  if (!env.MEDIA) return refuse(501, 'E_NOT_CONFIGURED', 'Storage for your own ending is not set up yet.');

  if (method === 'GET') {
    const file = await env.MEDIA.get(fileKey(account.id));
    if (!file) return refuse(404, 'E_NOT_FOUND', 'No ending uploaded.');
    return new Response(file.body, {
      headers: { 'Content-Type': file.httpMetadata?.contentType ?? 'video/mp4', 'Cache-Control': 'private, no-store' },
    });
  }
  if (method === 'DELETE') {
    await env.MEDIA.delete(fileKey(account.id));
    await setMode(env, account.id, 'kavox', null);
    return json(await outroInfo(env, { ...account, outro: 'kavox', outro_size: null }));
  }
  if (method === 'PUT') {
    if (!plan) return refuse(402, 'E_PLAN_NEEDED', 'Your own ending comes with a monthly plan.');
    const type = request.headers.get('Content-Type') ?? '';
    if (!type.startsWith('video/')) return refuse(415, 'E_BAD_REQUEST', 'Choose a video file (MP4, MOV or WebM).');
    const length = Number(request.headers.get('Content-Length') ?? 0);
    if (!length) return refuse(411, 'E_BAD_REQUEST', 'The file size is missing.');
    if (length > OUTRO_MAX_BYTES) return refuse(413, 'E_FILE_TOO_LARGE', `Your ending can be up to ${OUTRO_MAX_BYTES / 1024 / 1024} MB.`);
    if (!request.body) return refuse(400, 'E_BAD_REQUEST', 'The file is empty.');
    await env.MEDIA.put(fileKey(account.id), request.body, { httpMetadata: { contentType: type } });
    await setMode(env, account.id, 'custom', length);
    return json(await outroInfo(env, { ...account, outro: 'custom', outro_size: length }));
  }
  return refuse(405, 'E_BAD_REQUEST', 'Method not allowed.');
}
