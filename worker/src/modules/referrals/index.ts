/**
 * Referrals brick: invite links on the website and in the bot, friends counted when their first
 * video is made, and (switched on from /admin, with credits on) free minutes for both sides.
 * This file is the brick's only public interface.
 */
export { CODE_RE, REFERRALS_SCHEMA, codeFor, eraseReferrals, invitedBy, recordReferral, referralTotals, referralsOf } from './store';
export { referralsJobListener, rewardMinutes } from './service';
export { handleReferral } from './handlers';
