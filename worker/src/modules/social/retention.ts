import { now, type Env } from '../../shared/env';

/** Reports are kept at most a year (the Privacy Policy's promise), handled or not. */
export const REPORT_DAYS = 365;

/**
 * The Privacy Policy's promises for what people post, kept every hour: reports older than a year
 * go, and what belonged to a video, comment or profile that no longer exists (deleted by its
 * owner, expired after 30 days, or removed) goes with it: its comments, likes, notifications and
 * the reports about it.
 */
export async function sweepSocial(env: Env): Promise<void> {
  const gone = 'NOT IN (SELECT id FROM shares)';
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(now() - REPORT_DAYS * 86400),
    env.DB.prepare(`DELETE FROM comments WHERE share_id ${gone}`),
    env.DB.prepare(`DELETE FROM likes WHERE share_id ${gone}`),
    env.DB.prepare(`DELETE FROM notifications WHERE share_id IS NOT NULL AND share_id ${gone}`),
    env.DB.prepare('DELETE FROM notifications WHERE comment_id IS NOT NULL AND comment_id NOT IN (SELECT id FROM comments)'),
    env.DB.prepare(`DELETE FROM reports WHERE kind = 'video' AND target ${gone}`),
    env.DB.prepare("DELETE FROM reports WHERE kind = 'comment' AND CAST(target AS INTEGER) NOT IN (SELECT id FROM comments)"),
    env.DB.prepare("DELETE FROM reports WHERE kind = 'profile' AND target NOT IN (SELECT account_id FROM profiles)"),
  ]);
}
