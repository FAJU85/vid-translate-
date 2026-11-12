import { verifySigned } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError } from '../../shared/http';
import { TERMINAL, getJob } from '../jobs';
import { fileUrl, tg } from './api';

/** Lets the Space download a file a user sent to the bot (the Space cannot reach Telegram itself). */
export async function serveTelegramFile(env: Env, url: URL, jobId: string): Promise<Response> {
  const ok = await verifySigned(env.SHARED_SECRET, `tgfile:${jobId}`, url.searchParams.get('exp'), url.searchParams.get('sig'));
  if (!ok) return apiError(403, 'E_FORBIDDEN', 'Invalid or expired link.');
  const job = await getJob(env, jobId);
  if (!job || job.source_kind !== 'telegram' || TERMINAL.includes(job.status)) {
    return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
  }
  const file = await tg<{ file_path?: string }>(env, 'getFile', { file_id: job.source });
  if (!file?.file_path) return apiError(502, 'E_DOWNLOAD_FAILED', 'Telegram did not return the file.');
  const upstream = await fetch(fileUrl(env, file.file_path));
  if (!upstream.ok) return apiError(502, 'E_DOWNLOAD_FAILED', 'Telegram file download failed.');
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { headers });
}
