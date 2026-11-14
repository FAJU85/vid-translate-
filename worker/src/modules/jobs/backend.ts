import { signedQuery } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import type { BackendState } from './model';

/** Client for the Hugging Face Space (see backend/README.md for the contract). */

const base = (env: Env) => env.BACKEND_URL.replace(/\/$/, '');
const authHeaders = (env: Env) => ({ Authorization: `Bearer ${env.SHARED_SECRET}` });

export interface InvokeBody {
  job_id: string;
  source_kind: string;
  source_url?: string;
  src_lang: string;
  tgt_lang: string;
  subtitle_mode: string;
  callback_url: string;
  title: string | null;
}

export async function invoke(env: Env, body: InvokeBody): Promise<{ status: number; data: { status?: string; error?: string } | null }> {
  const res = await fetch(`${base(env)}/invoke`, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as { status?: string; error?: string } | null };
}

/** Ask the Space to stop a job. True once the Space confirms, or no longer knows the job. */
export async function cancel(env: Env, jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(env)}/cancel/${jobId}`, {
      method: 'POST',
      headers: authHeaders(env),
      signal: AbortSignal.timeout(8_000),
    });
    // 404 with a JSON body means the Space no longer knows the job: nothing left to stop.
    return res.ok || (res.status === 404 && Boolean(await res.json().catch(() => null)));
  } catch {
    return false;
  }
}

/** The job's state on the Space; 'unknown' if the Space answered but has no such job. */
export async function status(env: Env, jobId: string): Promise<BackendState | 'unknown' | null> {
  const res = await fetch(`${base(env)}/status/${jobId}`, { headers: authHeaders(env), signal: AbortSignal.timeout(10_000) });
  if (res.status === 404 && (await res.json().catch(() => null))) return 'unknown';
  return res.ok ? ((await res.json()) as BackendState) : null;
}

export async function fileLink(env: Env, jobId: string, name: string, ttl: number, filename?: string): Promise<string> {
  const query = await signedQuery(env.SHARED_SECRET, `file:${jobId}:${name}`, ttl);
  return `${base(env)}/files/${jobId}/${name}?${query}${filename ? `&filename=${encodeURIComponent(filename)}` : ''}`;
}

export async function uploadLink(env: Env, jobId: string): Promise<string> {
  return `${base(env)}/upload/${jobId}?${await signedQuery(env.SHARED_SECRET, `upload:${jobId}`, 2 * 3600)}`;
}

/** Upload a job's source file to the Space (as a browser would). Returns the HTTP status. */
export async function upload(env: Env, jobId: string, file: { body: ReadableStream<Uint8Array>; length: number | null }): Promise<number> {
  let body = file.body;
  if (file.length !== null) {
    // A known length is sent as Content-Length instead of a chunked body.
    const fixed = new FixedLengthStream(file.length);
    file.body.pipeTo(fixed.writable).catch(() => {});
    body = fixed.readable;
  }
  const res = await fetch(await uploadLink(env, jobId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  return res.status;
}

export async function health(env: Env): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${base(env)}/health`, { signal: AbortSignal.timeout(8_000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
