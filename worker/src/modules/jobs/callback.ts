import { hmacHex, safeEqual } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { UUID, apiError, json } from '../../shared/http';
import type { BackendState } from './model';
import { applyState } from './service';
import { getJob } from './store';

/** Progress reports from the Space, authenticated with an HMAC over timestamp + body. */
export async function handleBackendCallback(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const ts = request.headers.get('X-Timestamp') ?? '';
  const sig = request.headers.get('X-Signature') ?? '';
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 600;
  if (!sig || !fresh || !safeEqual(await hmacHex(env.SHARED_SECRET, `${ts}.${body}`), sig)) {
    return apiError(401, 'E_UNAUTHORIZED', 'Invalid callback signature.');
  }
  let state: BackendState;
  try {
    state = JSON.parse(body);
  } catch {
    return apiError(400, 'E_BAD_REQUEST', 'Invalid JSON.');
  }
  const job = UUID.test(state.job_id ?? '') ? await getJob(env, state.job_id) : null;
  if (!job) return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
  await applyState(env, job, state);
  return json({ ok: true });
}
