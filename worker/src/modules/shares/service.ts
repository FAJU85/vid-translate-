import { now, type Env } from '../../shared/env';
import { hasPlan, jobAccount } from '../accounts';
import { fileLink, type JobListener, type JobRow } from '../jobs';
import { publicOrigin } from '../settings';
import { deleteShareRow, insertShare, shareForJob, updateShare, type ShareRow } from './store';

/** Free accounts' links last this long; monthly plans keep theirs until they delete them. */
export const FREE_SHARE_SECONDS = 30 * 86400;
const MAX_COPY_ATTEMPTS = 6;
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 10 characters that are hard to misread (no 0/O, 1/l/I): about 58^10 possibilities. */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

export const videoKey = (id: string) => `shares/${id}/video.mp4`;
export const thumbKey = (id: string) => `shares/${id}/thumb.jpg`;

/** The rendered video of a finished job (burned-in subtitles or dubbed), by its file name. */
export function videoFile(job: Pick<JobRow, 'mode' | 'outputs'>): string | null {
  const outputs = JSON.parse(job.outputs || '{}') as Record<string, string>;
  if (job.mode === 'hard' && outputs.mp4) return outputs.mp4;
  if (job.mode === 'dub' && outputs.dubbed && /\.mp4$/.test(outputs.dubbed)) return outputs.dubbed;
  return null;
}

/** A finished video gets its share page at once; its files are copied to R2 by the next sweep. */
async function createShare(env: Env, job: JobRow): Promise<void> {
  if (!env.MEDIA || job.status !== 'done' || !videoFile(job)) return;
  const account = await jobAccount(env, job);
  const keep = account && (await hasPlan(env, account.id));
  const ts = now();
  const outputs = JSON.parse(job.outputs || '{}') as Record<string, string>;
  // Two finished-notices for one job: the second insert is ignored (job_id is unique).
  await insertShare(env, {
    id: newId(),
    job_id: job.id,
    owner: job.owner,
    account_id: account?.id ?? null,
    title: job.title,
    src_lang: job.detected_lang ?? job.src_lang,
    tgt_lang: job.tgt_lang,
    mode: job.mode,
    duration: job.duration,
    status: 'pending',
    size: null,
    has_thumb: outputs.thumb ? 1 : 0,
    copy_attempts: 0,
    views: 0,
    created_at: ts,
    expires_at: keep ? null : ts + FREE_SHARE_SECONDS,
  });
}

/**
 * Port through which another brick (social) says who made a video: their @handle and name, for
 * the video's page. Registered by the base; without it a page shows no creator.
 */
export type CreatorLookup = (env: Env, accountId: string) => Promise<{ handle: string; name: string | null } | null>;
let creatorLookup: CreatorLookup | null = null;
export function registerCreatorLookup(lookup: CreatorLookup): void {
  creatorLookup = lookup;
}
export async function creatorOf(env: Env, share: Pick<ShareRow, 'account_id' | 'visibility'>) {
  // A link-only video does not say who made it: only one posted to a profile does.
  if (!creatorLookup || !share.account_id || share.visibility !== 'public') return null;
  return creatorLookup(env, share.account_id).catch(() => null);
}

/** Plugs shares into the jobs brick. Registered before Telegram, whose message carries the link. */
export const sharesJobListener: JobListener = {
  changed: async () => {},
  finished: createShare,
};

/** Copy one file from the Space into R2 (streamed, never held in memory). */
async function copyFile(env: Env, jobId: string, name: string, key: string, type: string): Promise<number | null> {
  const res = await fetch(await fileLink(env, jobId, name, 3600), { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return res.status === 404 ? -1 : null;
  }
  const length = Number(res.headers.get('content-length'));
  let body: ReadableStream = res.body;
  if (length > 0) {
    const fixed = new FixedLengthStream(length);
    res.body.pipeTo(fixed.writable).catch(() => {});
    body = fixed.readable;
  }
  const stored = await env.MEDIA!.put(key, body, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=86400' } });
  return stored?.size ?? null;
}

/** Cron: copy waiting shares to R2 (a few per minute), and remove expired ones. */
export async function sweepShares(env: Env): Promise<void> {
  if (!env.MEDIA) return;
  const { results: pending } = await env.DB.prepare(
    "SELECT shares.*, jobs.outputs AS outputs FROM shares JOIN jobs ON jobs.id = shares.job_id WHERE shares.status = 'pending' ORDER BY shares.created_at LIMIT 3",
  ).all<ShareRow & { outputs: string | null }>();
  for (const share of pending) {
    const file = videoFile({ mode: share.mode as JobRow['mode'], outputs: share.outputs });
    try {
      const size = file ? await copyFile(env, share.job_id, file, videoKey(share.id), 'video/mp4') : -1;
      if (size === -1) {
        await updateShare(env, share.id, { status: 'failed' }); // gone from the Space: nothing to keep
        continue;
      }
      if (size === null) throw new Error('copy failed');
      if (share.has_thumb) await copyFile(env, share.job_id, 'thumb.jpg', thumbKey(share.id), 'image/jpeg').catch(() => null);
      await updateShare(env, share.id, { status: 'ready', size });
    } catch (err) {
      console.warn(`share ${share.id}: copy failed`, (err as Error).message);
      const attempts = share.copy_attempts + 1;
      await updateShare(env, share.id, attempts >= MAX_COPY_ATTEMPTS ? { status: 'failed', copy_attempts: attempts } : { copy_attempts: attempts });
    }
  }
  // Expired links (and lost files): their files go, then their rows.
  const { results: old } = await env.DB.prepare(
    "SELECT id FROM shares WHERE (expires_at IS NOT NULL AND expires_at < ?) OR status = 'failed' LIMIT 20",
  )
    .bind(now())
    .all<{ id: string }>();
  for (const { id } of old) await deleteShare(env, id);
}

/** Remove a share and its files. */
export async function deleteShare(env: Env, id: string): Promise<void> {
  if (env.MEDIA) await env.MEDIA.delete([videoKey(id), thumbKey(id)]);
  await deleteShareRow(env, id);
}

/** A job's public link, once it has one. */
export async function shareUrl(env: Env, job: Pick<JobRow, 'id' | 'origin'>): Promise<string | null> {
  const share = await shareForJob(env, job.id);
  return share ? `${await publicOrigin(env, job.origin)}/${share.id}` : null;
}
