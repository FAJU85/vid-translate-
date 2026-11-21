import type { Env } from '../../shared/env';
import { TERMINAL, getJob, stopJob, type JobListener, type JobRow } from '../jobs';
import { balance, costSeconds, creditsEnabled, refund, reserve, settle } from './credits';

export type ChargeResult = { ok: true } | { ok: false; need: number; have: number };

/**
 * Set credits aside for a job about to start. The length is often not known yet (a link): then a
 * hint (the browser's or Telegram's reading of the file) or the minimum is set aside, and the
 * real cost is settled once the Space has measured the video. Does nothing while credits are off.
 */
export async function chargeJob(env: Env, accountId: string, job: JobRow, durationHint?: number | null): Promise<ChargeResult> {
  if (!creditsEnabled(env)) return { ok: true };
  const need = costSeconds(job.duration ?? durationHint, job.mode, job.source_kind);
  if (need <= 0) return { ok: true };
  if (await reserve(env, accountId, job.id, need, job.title)) {
    // Cancelled while the credits were being set aside (the bot's Cancel button)? Give them back.
    const fresh = await getJob(env, job.id);
    if (fresh && TERMINAL.includes(fresh.status) && fresh.status !== 'done') await refund(env, job.id, 'cancelled');
    return { ok: true };
  }
  return { ok: false, need, have: (await balance(env, accountId)).total_seconds };
}

/** What a job will cost, for a preview before it starts. */
export const estimateSeconds = (durationSeconds: number | null | undefined, mode: string) => costSeconds(durationSeconds, mode, 'url');

/**
 * Follows jobs through the jobs brick's listener port: gives credits back when a job fails or is
 * cancelled, and settles the real cost once the video's length is known. A job whose real length
 * costs more than the account has is stopped before the heavy work starts, and nothing is charged.
 */
export const billingListener: JobListener = {
  async changed(env, job) {
    if (TERMINAL.includes(job.status)) {
      if (job.status !== 'done') await refund(env, job.id, job.status === 'cancelled' ? 'cancelled' : `failed: ${job.error_code ?? ''}`);
      return;
    }
    if (job.duration && job.status === 'running') {
      const ok = await settle(env, job.id, costSeconds(job.duration, job.mode, job.source_kind), false);
      if (!ok) {
        await stopJob(env, job, 'E_NO_CREDITS', 'This video is longer than your credits cover. Add credits and try again.');
      }
    }
  },
  async finished(env, job) {
    // The result exists either way: if the account could not cover the full length, the job keeps
    // what was set aside and the rest is written in the ledger as unpaid (settle does that).
    await settle(env, job.id, costSeconds(job.duration, job.mode, job.source_kind), true);
  },
};

/** Give back what was set aside for a job that will not run after all (e.g. refused by a limit). */
export const releaseJob = (env: Env, jobId: string, reason: string) => refund(env, jobId, reason);
