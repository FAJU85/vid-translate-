import type { Env } from '../../shared/env';
import { TERMINAL, getJob, stopJob, type JobListener, type JobRow } from '../jobs';
import {
  DUB_PREVIEW_MAX_SECONDS,
  FREE_MAX_VIDEO_SECONDS,
  freeLimit,
  freshBalance,
  giveBackDubPreview,
  paid,
  useDubPreview,
} from './allowances';
import { costSeconds, creditsEnabled, holdInfo, refund, reserve, settle } from './credits';
import type { Account } from './store';

/** Why a job cannot start: too few credits, longer than free videos may be, or dubbing (paid). */
export type Refusal = 'credits' | 'free_limit' | 'dub_paid';
export type ChargeResult = { ok: true } | { ok: false; reason: Refusal; need: number; have: number };

/** What a job will cost, for a preview before it starts. */
export const estimateSeconds = (durationSeconds: number | null | undefined, mode: string) => costSeconds(durationSeconds, mode, 'url');

/**
 * Whether a job of this kind and (estimated) length could start now, without setting anything
 * aside: for refusing at once, before a file is uploaded or a job created.
 */
export async function checkJob(env: Env, account: Account, mode: string, durationHint?: number | null): Promise<ChargeResult> {
  if (!creditsEnabled(env)) return { ok: true };
  const b = await freshBalance(env, account);
  const need = estimateSeconds(durationHint, mode);
  const limit = freeLimit(account, b, mode, durationHint);
  if (limit) return { ok: false, reason: limit, need, have: b.total_seconds };
  if (b.total_seconds < need) return { ok: false, reason: 'credits', need, have: b.total_seconds };
  return { ok: true };
}

/**
 * Set credits aside for a job about to start. The length is often not known yet (a link): then a
 * hint (the browser's or Telegram's reading of the file) or the minimum is set aside, and the
 * real cost is settled once the Space has measured the video. Does nothing while credits are off.
 */
export async function chargeJob(env: Env, account: Account, job: JobRow, durationHint?: number | null): Promise<ChargeResult> {
  if (!creditsEnabled(env)) return { ok: true };
  const need = costSeconds(job.duration ?? durationHint, job.mode, job.source_kind);
  if (need <= 0) return { ok: true };
  const b = await freshBalance(env, account);
  const limit = job.source_kind === 'rerender' ? null : freeLimit(account, b, job.mode, job.duration ?? durationHint);
  if (limit) return { ok: false, reason: limit, need, have: b.total_seconds };
  const free = !paid(b);
  if (!(await reserve(env, account.id, job.id, need, job.title, free))) {
    return { ok: false, reason: 'credits', need, have: (await freshBalance(env, account)).total_seconds };
  }
  // The one free dubbing preview: taken now (a second request at the same moment gets none).
  if (free && job.mode === 'dub' && !(await useDubPreview(env, account.id))) {
    await refund(env, job.id, 'dubbing needs credits');
    return { ok: false, reason: 'dub_paid', need, have: b.total_seconds };
  }
  // Cancelled while the credits were being set aside (the bot's Cancel button)? Give them back.
  const fresh = await getJob(env, job.id);
  if (fresh && TERMINAL.includes(fresh.status) && fresh.status !== 'done') await refund(env, job.id, 'cancelled');
  return { ok: true };
}

/**
 * Follows jobs through the jobs brick's listener port: gives credits back when a job fails or is
 * cancelled, and settles the real cost once the video's length is known. A job whose real length
 * costs more than the account has, or is longer than free videos may be, is stopped before the
 * heavy work starts, and nothing is charged.
 */
export const billingListener: JobListener = {
  async changed(env, job) {
    if (TERMINAL.includes(job.status)) {
      if (job.status === 'done') return;
      const hold = await holdInfo(env, job.id);
      await refund(env, job.id, job.status === 'cancelled' ? 'cancelled' : `failed: ${job.error_code ?? ''}`);
      // A free dubbing preview that did not work out can be tried again.
      if (hold?.free && job.mode === 'dub' && hold.status === 'held') await giveBackDubPreview(env, hold.account_id);
      return;
    }
    if (job.duration && job.status === 'running') {
      const hold = await holdInfo(env, job.id);
      if (hold?.status === 'held' && hold.free && job.source_kind !== 'rerender') {
        if (job.mode === 'dub' && job.duration > DUB_PREVIEW_MAX_SECONDS) {
          await stopJob(env, job, 'E_DUB_PAID', `The free dubbing preview is for videos up to ${DUB_PREVIEW_MAX_SECONDS} seconds.`);
          return;
        }
        if (job.duration > FREE_MAX_VIDEO_SECONDS) {
          await stopJob(env, job, 'E_FREE_LIMIT', `Free videos can be up to ${FREE_MAX_VIDEO_SECONDS} seconds long.`);
          return;
        }
      }
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
