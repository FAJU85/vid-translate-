import { connectionKey } from '../../shared/crypto';
import { now, type Env } from '../../shared/env';
import { audit } from '../audit';
import { apiError, json } from '../../shared/http';
import { eraseAccount, exportAccount, personFor, renameAccount } from '../accounts';
import { eraseFeedback, exportFeedback } from '../feedback';
import { eraseJobs, exportJobs } from '../jobs';
import { eraseLearning, exportLearning } from '../learning';
import { LEGAL_VERSION, publicSettings } from '../settings';
import { eraseShares, exportShares } from '../shares';
import { eraseSocial, exportSocial } from '../social';
import { eraseTelegram, exportTelegram } from '../telegram';

/**
 * The PDPL rights in the Dashboard, for the signed-in account or (signed out) this browser:
 * GET /api/me/export   "Download my data": everything linked to the person, as a JSON file;
 * POST /api/me/delete  "Delete my account": everything, permanently (files in storage included);
 * POST /api/me/name    correct the name shown for the account.
 */
export async function handlePrivacy(request: Request, env: Env, path: string): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method;

  if (path === '/api/me/export' && method === 'GET') {
    const person = await personFor(env, request, url.searchParams.get('client_id'));
    if (!person) return apiError(400, 'E_BAD_REQUEST', 'Sign in first, or use the browser you translated in.');
    const actor = person.accountId ? `user:${person.accountId}` : `guest:${person.owners[0] ?? '?'}`;
    await audit(env, { actor, action: 'data.export', conn: await connectionKey(env.SHARED_SECRET, request) });
    const site = await publicSettings(env).catch(() => null);
    const data = {
      about: `Your personal data at ${site?.name || 'KAVOX'}, exported ${new Date().toISOString()}. Privacy Policy version ${LEGAL_VERSION}.`,
      account: await exportAccount(env, person),
      jobs: await exportJobs(env, person),
      videos: await exportShares(env, person),
      social: await exportSocial(env, person),
      feedback: await exportFeedback(env, person),
      learning: await exportLearning(env, person),
      telegram_bot: await exportTelegram(env, person),
    };
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="kavox-my-data-${now()}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (path === '/api/me/delete' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.confirm !== true) return apiError(400, 'E_BAD_REQUEST', 'Confirm that you want to delete everything.');
    const person = await personFor(env, request, typeof body?.client_id === 'string' ? body.client_id : null);
    if (!person) return apiError(400, 'E_BAD_REQUEST', 'Sign in first, or use the browser you translated in.');
    // Files first (so nothing is left in storage without its record), the account last.
    const videos = await eraseShares(env, person);
    const jobs = await eraseJobs(env, person);
    await eraseSocial(env, person);
    await eraseFeedback(env, person);
    await eraseLearning(env, person);
    await eraseTelegram(env, person);
    await eraseAccount(env, person);
    // Kept without the person's details: only that an account was deleted, and how much went.
    await audit(env, { actor: person.accountId ? 'user' : 'guest', action: 'account.delete', detail: { videos, jobs }, conn: await connectionKey(env.SHARED_SECRET, request) });
    return json({ ok: true, deleted: { videos, jobs } }, 200, {
      'Set-Cookie': 'kavox_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    });
  }

  if (path === '/api/me/name' && method === 'POST') {
    const person = await personFor(env, request, null);
    if (!person?.accountId) return apiError(401, 'E_SIGN_IN', 'Sign in first.');
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const name = String(body?.name ?? '').trim().slice(0, 80);
    await renameAccount(env, person.accountId, name || null);
    return json({ ok: true, name: name || null });
  }
  return null;
}
