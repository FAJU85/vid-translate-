import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { getAccount, signedInAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { getShare } from '../shares';
import { sendTelegramMessage } from '../telegram';
import { getComment, isBlocked, profilesByAccounts } from './store';

export type NotificationKind = 'follow' | 'like' | 'comment' | 'post' | SystemKind;
/** A notice from KAVOX itself: something of yours was taken down after a report. */
export type SystemKind = 'removed';
const SYSTEM: readonly string[] = ['removed'];

/** What a notice from KAVOX is about: a video (its title) or a comment (its text). */
export interface NoticeDetail {
  what: 'video' | 'comment';
  title?: string | null;
  text?: string | null;
  /** removed: only hidden (a comment), not deleted. */
  hidden?: boolean;
}

interface NotificationRow {
  id: number;
  account_id: string;
  kind: NotificationKind;
  actor_id: string;
  share_id: string | null;
  comment_id: number | null;
  created_at: number;
  tg_sent: number;
  detail: string | null;
}

const PAGE = 30;
/** Notifications are kept this long. */
const KEEP_DAYS = 90;
/** A creator's new video reaches at most this many followers' inboxes. */
const FAN_OUT = 5000;
/** Telegram messages sent per minute (the bot's limit is ~30 a second; this stays far below). */
const TG_PER_RUN = 60;

/**
 * Tell someone what another account did: followed them, liked or commented on their video.
 * Nothing for your own actions; a follow or like repeated (undone and done again) is told once.
 */
export async function notify(
  env: Env,
  n: { to: string | null | undefined; kind: 'follow' | 'like' | 'comment'; actor: string; shareId?: string; commentId?: number },
): Promise<void> {
  if (!n.to || n.to === n.actor) return;
  const once = n.kind !== 'comment';
  await env.DB.prepare(
    `INSERT INTO notifications (account_id, kind, actor_id, share_id, comment_id, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
     WHERE NOT ?7 OR NOT EXISTS (SELECT 1 FROM notifications WHERE account_id = ?1 AND kind = ?2 AND actor_id = ?3 AND share_id IS ?4)`,
  )
    .bind(n.to, n.kind, n.actor, n.shareId ?? null, n.commentId ?? null, now(), once ? 1 : 0)
    .run();
}

/** A creator posted a video: tell their followers (once per video, however often it is re-posted). */
export async function notifyPost(env: Env, share: { id: string; account_id: string | null }): Promise<void> {
  if (!share.account_id || (await isBlocked(env, share.account_id))) return;
  await env.DB.prepare(
    `INSERT INTO notifications (account_id, kind, actor_id, share_id, created_at)
     SELECT f.follower_id, 'post', ?1, ?2, ?3 FROM follows f
     WHERE f.followee_id = ?1
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.kind = 'post' AND n.share_id = ?2 AND n.account_id = f.follower_id)
     LIMIT ${FAN_OUT}`,
  )
    .bind(share.account_id, share.id, now())
    .run();
}

const quote = (s: string | null | undefined, max = 80) => {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A notice from KAVOX as text (Telegram HTML when `html`), in English or Arabic. */
export function noticeText(kind: SystemKind, d: NoticeDetail, lang: string, html = false): string {
  const e = (s: string) => (html ? esc(s) : s);
  const ar = lang === 'ar';
  const name = e(quote(d.what === 'video' ? d.title : d.text)) || (ar ? (d.what === 'video' ? 'بلا عنوان' : '…') : d.what === 'video' ? 'untitled' : '…');
  if (d.what === 'video') {
    return ar
      ? `أُزيل فيديو «${name}» بعد بلاغ، لأنه يخالف شروط الاستخدام. لا يراه الآن غيرك، ويمكنك حذفه من لوحتك. إن رأيت أن هذا خطأ فراسلنا.`
      : `Your video “${name}” was taken down after a report, because it breaks the Terms of Use. Only you can see it now, and you can delete it from your Dashboard. If you think this is a mistake, write to us.`;
  }
  return ar
    ? `${d.hidden ? 'أُخفي' : 'حُذف'} تعليقك «${name}» بعد بلاغ، لأنه يخالف شروط الاستخدام.`
    : `Your comment “${name}” was ${d.hidden ? 'hidden' : 'removed'} after a report, because it breaks the Terms of Use.`;
}

/**
 * Tell the owner when something of theirs is taken down after a report (a video or a comment): in
 * their inbox when they have an account, and by the bot when the video was made in Telegram.
 */
export async function notifyOwner(
  env: Env,
  owner: { account_id: string | null; owner?: string | null },
  kind: SystemKind,
  detail: NoticeDetail,
  opts: { shareId?: string | null; lang?: string | null } = {},
): Promise<void> {
  const chat = owner.owner?.startsWith('tg:') ? Number(owner.owner.slice(3)) || null : null;
  const sentByBot = Boolean(chat && env.TELEGRAM_BOT_TOKEN);
  if (owner.account_id) {
    await env.DB.prepare(
      'INSERT INTO notifications (account_id, kind, actor_id, share_id, created_at, tg_sent, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(owner.account_id, kind, owner.account_id, opts.shareId ?? null, now(), sentByBot ? 1 : 0, JSON.stringify(detail))
      .run();
  }
  if (sentByBot) await sendTelegramMessage(env, chat!, noticeText(kind, detail, opts.lang === 'ar' ? 'ar' : 'en', true)).catch(() => {});
}

const prefsOf = (env: Env, accountId: string) =>
  env.DB.prepare('SELECT seen_id, telegram FROM notify_prefs WHERE account_id = ?').bind(accountId).first<{ seen_id: number; telegram: number }>();

async function unreadCount(env: Env, accountId: string, seenId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM notifications n WHERE n.account_id = ? AND n.id > ?
       AND (n.kind = 'removed' OR NOT EXISTS (SELECT 1 FROM blocked_accounts b WHERE b.account_id = n.actor_id)) LIMIT 100)`,
  )
    .bind(accountId, seenId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The notifications as the inbox shows them; those whose video, comment or actor is gone are left out. */
async function present(env: Env, rows: NotificationRow[], base: string) {
  const actors = await profilesByAccounts(env, [...new Set(rows.map((r) => r.actor_id))]);
  const shares = new Map<string, Awaited<ReturnType<typeof getShare>>>();
  for (const id of new Set(rows.map((r) => r.share_id).filter((x): x is string => Boolean(x)))) shares.set(id, await getShare(env, id));
  const out: {
    id: number;
    kind: NotificationKind;
    created_at: number;
    actor: { handle: string; display_name: string | null } | null;
    video: { id: string; title: string | null; url: string; thumb: string | null } | null;
    text: string | null;
    detail: NoticeDetail | null;
  }[] = [];
  for (const r of rows) {
    if (SYSTEM.includes(r.kind)) {
      // From KAVOX: about something of yours (the video may already be gone after a removal).
      const share = r.share_id ? shares.get(r.share_id) : null;
      out.push({
        id: r.id,
        kind: r.kind,
        created_at: r.created_at,
        actor: null,
        video: share ? { id: share.id, title: share.title, url: `${base}/${share.id}`, thumb: share.has_thumb ? `${base}/v/${share.id}/thumb.jpg` : null } : null,
        text: null,
        detail: JSON.parse(r.detail || '{}') as NoticeDetail,
      });
      continue;
    }
    const actor = actors.get(r.actor_id);
    if (!actor) continue;
    const share = r.share_id ? shares.get(r.share_id) : null;
    if (r.share_id && (!share || (r.kind === 'post' && share.visibility !== 'public'))) continue;
    let text: string | null = null;
    if (r.comment_id) {
      const c = await getComment(env, r.comment_id);
      if (!c || c.status !== 'visible') continue;
      text = c.text.length > 140 ? `${c.text.slice(0, 139)}…` : c.text;
    }
    out.push({
      id: r.id,
      kind: r.kind,
      created_at: r.created_at,
      actor: { handle: actor.handle, display_name: actor.display_name },
      video: share ? { id: share.id, title: share.title, url: `${base}/${share.id}`, thumb: share.has_thumb ? `${base}/v/${share.id}/thumb.jpg` : null } : null,
      text,
      detail: null as NoticeDetail | null,
    });
  }
  return out;
}

/**
 * GET /api/notifications?before= (the inbox, newest first, with the unread count),
 * GET /api/notifications/unread ({count}, for the bell), POST /api/notifications/read (all seen),
 * and POST /api/notifications/settings {telegram} (also send them by the Telegram bot).
 */
export async function handleNotifications(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (!path.startsWith('/api/notifications')) return null;
  const account = await signedInAccount(env, request);
  if (!account) return apiError(401, 'E_SIGN_IN', 'Sign in to see your notifications.');
  const prefs = (await prefsOf(env, account.id)) ?? { seen_id: 0, telegram: 0 };

  if (path === '/api/notifications/unread' && request.method === 'GET') {
    return json({ count: await unreadCount(env, account.id, prefs.seen_id) });
  }
  if (path === '/api/notifications' && request.method === 'GET') {
    const before = Number(new URL(request.url).searchParams.get('before')) || null;
    const { results } = await env.DB.prepare(
      `SELECT n.* FROM notifications n WHERE n.account_id = ?1 AND (?2 IS NULL OR n.id < ?2)
         AND (n.kind = 'removed' OR NOT EXISTS (SELECT 1 FROM blocked_accounts b WHERE b.account_id = n.actor_id))
       ORDER BY n.id DESC LIMIT ?3`,
    )
      .bind(account.id, before, PAGE)
      .all<NotificationRow>();
    return json({
      items: await present(env, results, await publicOrigin(env, origin)),
      next: results.length === PAGE ? String(results.at(-1)!.id) : null,
      seen_id: prefs.seen_id,
      unread: await unreadCount(env, account.id, prefs.seen_id),
      telegram: { linked: Boolean(account.telegram_id), on: Boolean(prefs.telegram) },
    });
  }
  if (path === '/api/notifications/read' && request.method === 'POST') {
    await env.DB.prepare(
      `INSERT INTO notify_prefs (account_id, seen_id, updated_at)
       VALUES (?1, COALESCE((SELECT MAX(id) FROM notifications WHERE account_id = ?1), 0), ?2)
       ON CONFLICT (account_id) DO UPDATE SET seen_id = excluded.seen_id, updated_at = excluded.updated_at`,
    )
      .bind(account.id, now())
      .run();
    return json({ ok: true });
  }
  if (path === '/api/notifications/settings' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { telegram?: unknown } | null;
    if (typeof body?.telegram !== 'boolean') return apiError(400, 'E_BAD_REQUEST', 'telegram is true or false.');
    if (body.telegram && !account.telegram_id) return apiError(400, 'E_NO_TELEGRAM', 'Telegram messages need an account that signs in with Telegram.');
    // Turning it on sends only what happens from now: older ones are marked as never to send.
    await env.DB.batch([
      env.DB.prepare('UPDATE notifications SET tg_sent = 1 WHERE account_id = ? AND tg_sent = 0').bind(account.id),
      env.DB.prepare(
        `INSERT INTO notify_prefs (account_id, telegram, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (account_id) DO UPDATE SET telegram = excluded.telegram, updated_at = excluded.updated_at`,
      ).bind(account.id, body.telegram ? 1 : 0, now()),
    ]);
    return json({ telegram: { linked: true, on: body.telegram } });
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** One notification as a Telegram message (HTML). */
function telegramText(n: Awaited<ReturnType<typeof present>>[number], lang: string): string {
  if (!n.actor) return noticeText(n.kind as SystemKind, n.detail ?? { what: 'video' }, lang, true);
  const who = `<b>@${esc(n.actor.handle)}</b>`;
  const title = esc(n.video?.title || (n.kind === 'post' ? 'a video' : 'your video'));
  // A link only when the address is known (the public domain or PUBLIC_URL): the cron has no request.
  const video = n.video?.url.startsWith('http') ? `<a href="${esc(n.video.url)}">${title}</a>` : title;
  switch (n.kind) {
    case 'follow':
      return `${who} started following you.`;
    case 'like':
      return `${who} liked ${video}.`;
    case 'comment':
      return `${who} commented on ${video}:\n${esc(n.text ?? '')}`;
    default:
      return `${who} posted a new video: ${video}`;
  }
}

/**
 * Every minute (the Worker's cron): send waiting notifications by Telegram to accounts that turned
 * it on, and drop notifications older than KEEP_DAYS. One failed message is not retried.
 */
export async function sweepNotifications(env: Env): Promise<void> {
  const origin = env.PUBLIC_URL ?? '';
  const ts = now();
  await env.DB.prepare('DELETE FROM notifications WHERE created_at < ?').bind(ts - KEEP_DAYS * 86400).run();
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const { results } = await env.DB.prepare(
    `SELECT n.* FROM notifications n JOIN notify_prefs p ON p.account_id = n.account_id AND p.telegram = 1
     WHERE n.tg_sent = 0 AND n.created_at > ? ORDER BY n.id LIMIT ${TG_PER_RUN}`,
  )
    .bind(ts - 3600)
    .all<NotificationRow>();
  if (!results.length) return;
  // Claimed first, so a slow run and the next one never send the same message twice.
  await env.DB.prepare(`UPDATE notifications SET tg_sent = 1 WHERE id IN (${results.map(() => '?').join(', ')})`)
    .bind(...results.map((r) => r.id))
    .run();
  const base = await publicOrigin(env, origin);
  const shown = new Map((await present(env, results, base)).map((n) => [n.id, n]));
  const chats = new Map<string, number | null>();
  for (const r of results) {
    const n = shown.get(r.id);
    if (!n) continue;
    if (!chats.has(r.account_id)) chats.set(r.account_id, (await getAccount(env, r.account_id))?.telegram_id ?? null);
    const chat = chats.get(r.account_id);
    if (chat) await sendTelegramMessage(env, chat, telegramText(n, 'en'));
  }
}
