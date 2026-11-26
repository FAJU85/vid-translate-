import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { accountForWeb } from '../accounts';
import { publicOrigin } from '../settings';
import { rewardMinutes } from './service';
import { codeFor, invitedBy } from './store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/referral?client_id=…: this person's invite link, how many friends it brought, and the
 * reward when rewards are on (null otherwise: then the site promises nothing).
 */
export async function handleReferral(request: Request, env: Env, origin: string): Promise<Response> {
  const client = new URL(request.url).searchParams.get('client_id') ?? '';
  if (!UUID.test(client)) return apiError(400, 'E_BAD_REQUEST', 'client_id is required.');
  const account = await accountForWeb(env, request, client);
  const code = await codeFor(env, account.id);
  const base = await publicOrigin(env, origin);
  return json({ code, link: `${base}/?invite=${code}`, ...(await invitedBy(env, account.id)), reward_minutes: rewardMinutes(env) });
}
