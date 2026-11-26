import { eraseAvatar } from './avatars';
import type { Env } from '../../shared/env';
import type { Person } from '../../shared/person';

/** A person's profile, posts' social side, comments, likes and follows, for "Download my data". */
export async function exportSocial(env: Env, p: Person) {
  if (!p.accountId) return null;
  const id = p.accountId;
  const all = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).all()).results;
  return {
    profile: await env.DB.prepare('SELECT handle, display_name, bio, avatar IS NOT NULL AS has_photo, created_at, updated_at FROM profiles WHERE account_id = ?').bind(id).first(),
    comments: await all('SELECT share_id, text, status, created_at FROM comments WHERE account_id = ? ORDER BY created_at DESC', id),
    likes: await all('SELECT share_id, created_at FROM likes WHERE account_id = ? ORDER BY created_at DESC', id),
    following: await all(
      'SELECT p.handle, f.created_at FROM follows f LEFT JOIN profiles p ON p.account_id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC',
      id,
    ),
    followers: (await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(id).first<{ n: number }>())?.n ?? 0,
    reports_sent: await all('SELECT kind, target, reason, details, created_at FROM reports WHERE reporter = ?', `acc:${id}`),
    // Your inbox (kept 90 days): who followed you, liked or commented on your videos, or posted.
    notifications: await all(
      'SELECT n.kind, p.handle AS from_handle, n.share_id, n.created_at FROM notifications n LEFT JOIN profiles p ON p.account_id = n.actor_id WHERE n.account_id = ? ORDER BY n.id DESC',
      id,
    ),
    notifications_telegram: Boolean((await env.DB.prepare('SELECT telegram FROM notify_prefs WHERE account_id = ?').bind(id).first<{ telegram: number }>())?.telegram),
  };
}

/** Delete everything social about a person: profile, comments, likes, follows both ways, notifications. */
export async function eraseSocial(env: Env, p: Person): Promise<void> {
  if (!p.accountId) return;
  const id = p.accountId;
  await eraseAvatar(env, id); // the profile photo, from storage
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comments WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM likes WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM notifications WHERE account_id = ? OR actor_id = ?').bind(id, id),
    env.DB.prepare('DELETE FROM notify_prefs WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM reports WHERE reporter = ?').bind(`acc:${id}`),
    // Reports about this profile (stored by account, since handles can change).
    env.DB.prepare("DELETE FROM reports WHERE kind = 'profile' AND target = ?").bind(id),
    env.DB.prepare('DELETE FROM blocked_accounts WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM profiles WHERE account_id = ?').bind(id),
  ]);
}
