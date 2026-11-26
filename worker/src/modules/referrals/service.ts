import type { Env } from '../../shared/env';
import { creditsEnabled, grant } from '../accounts';
import type { JobRow } from '../jobs';
import { markFirstVideo, waitingReferral } from './store';

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
    // Marked first, so a job finishing twice (retries) never pays twice.
    if (!(await markFirstVideo(env, waiting.referred_account, minutes !== null))) return;
    if (minutes === null) return;
    const seconds = minutes * 60;
    await grant(env, waiting.referred_account, 'bonus', seconds, 'invite: welcome gift');
    await grant(env, waiting.referrer_account, 'bonus', seconds, 'invite: a friend made a first video');
  },
};
