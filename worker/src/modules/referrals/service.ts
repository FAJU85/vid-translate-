import type { Env } from '../../shared/env';
import { creditsEnabled, grantStatements, guardChanged } from '../accounts';
import type { JobRow } from '../jobs';
import { markFirstVideoStatement, waitingReferral } from './store';

const on = (v: string | undefined) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());

/**
 * The free minutes each side gets for a friend's first video, or null when rewards are off (the
 * admin's switch, REFERRAL_REWARDS) or credits are off (nothing to give then).
 */
export function rewardMinutes(env: Env): number | null {
  if (!on(env.REFERRAL_REWARDS) || !creditsEnabled(env)) return null;
  const n = Number(env.REFERRAL_MINUTES);
  return Number.isInteger(n) && n >= 1 && n <= 120 ? n : 10;
}

/**
 * Jobs listener: a friend's first finished video counts their invite; with rewards on, both the
 * friend and whoever invited them get the free minutes, once (a "bonus" that does not expire).
 */
export const referralsJobListener = {
  async changed() {},
  async finished(env: Env, job: JobRow) {
    if (job.source_kind === 'rerender') return;
    const waiting = await waitingReferral(env, job.owner, job.account_id);
    if (!waiting) return;
    const minutes = rewardMinutes(env);
    // The friend's gift goes to whoever made the video (a guest who signed in since: their account).
    const friend = job.account_id ?? waiting.referred_account;
    const pay = minutes !== null && friend !== waiting.referrer_account;
    // One transaction: marked, and both sides paid, or nothing at all. The guard stops the batch
    // when the referral was already marked (a job reported finished twice): never paid twice. A
    // failed grant undoes the mark too, so a later video can still complete it.
    await env.DB.batch([
      markFirstVideoStatement(env, waiting.referred_account, pay),
      guardChanged(env),
      ...(pay
        ? [
            ...grantStatements(env, friend, 'bonus', minutes! * 60, 'invite: welcome gift'),
            ...grantStatements(env, waiting.referrer_account, 'bonus', minutes! * 60, 'invite: a friend made a first video'),
          ]
        : []),
    ]).catch(() => {
      /* already marked (the guard), or the database refused: nothing was changed */
    });
  },
};
