import { hmacHex } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { signedInAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { getJob } from '../jobs';
import { getPostedVideo, getShare, takeDownShare } from '../shares';
import { avatarUrl, hideAvatar } from './avatars';
import { notify, notifyOwner } from './notifications';
import {
  REPORT_KINDS,
  REPORT_REASONS,
  addComment,
  addReport,
  blockAccount,
  closeReports,
  deleteComment,
  getComment,
  isBlocked,
  listBlocked,
  listComments,
  openReports,
  profileByAccount,
  profileByHandle,
  profilesByAccounts,
  recentComments,
  recentReports,
  setCommentStatus,
  unblockAccount,
  type ReportKind,
  type ReportReason,
} from './store';

const MAX_COMMENT = 500;
const COMMENTS_PAGE = 30;
/** At most this many comments per account in COMMENT_WINDOW seconds (spam), and reports per reporter an hour. */
const COMMENT_BURST = 10;
const COMMENT_WINDOW = 600;
const REPORTS_PER_HOUR = 20;

/** Who is reporting: the signed-in account, or (signed out) a keyed hash of the address, never the address itself. */
async function reporterKey(env: Env, request: Request, accountId: string | null): Promise<string> {
  if (accountId) return `acc:${accountId}`;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return `ip:${(await hmacHex(env.SHARED_SECRET || 'kavox', `reporter:${ip}`)).slice(0, 24)}`;
}

/**
 * GET/POST /api/comments/<video> (read; write: signed in with a profile), DELETE /api/comments/<id>
 * (its author or the video's owner), and POST /api/reports {kind, target, reason, details}.
 */
export async function handleComments(request: Request, env: Env, path: string): Promise<Response | null> {
  const method = request.method;
  const onVideo = path.match(/^\/api\/comments\/([A-Za-z0-9]{10})$/);

  if (onVideo && method === 'GET') {
    const video = await getPostedVideo(env, onVideo[1]);
    if (!video) return json({ items: [], next: null });
    const viewer = (await signedInAccount(env, request))?.id ?? null;
    const before = Number(new URL(request.url).searchParams.get('before')) || null;
    const rows = await listComments(env, video.id, before, COMMENTS_PAGE);
    const authors = await profilesByAccounts(env, [...new Set(rows.map((c) => c.account_id))]);
    return json({
      items: rows
        .filter((c) => authors.has(c.account_id))
        .map((c) => ({
          id: c.id,
          text: c.text,
          created_at: c.created_at,
          author: { handle: authors.get(c.account_id)!.handle, display_name: authors.get(c.account_id)!.display_name },
          can_delete: viewer !== null && (viewer === c.account_id || viewer === video.account_id),
        })),
      next: rows.length === COMMENTS_PAGE ? String(rows.at(-1)!.id) : null,
    });
  }

  if (onVideo && method === 'POST') {
    const account = await signedInAccount(env, request);
    if (!account) return apiError(401, 'E_SIGN_IN', 'Sign in to comment.');
    if (await isBlocked(env, account.id)) return apiError(403, 'E_BLOCKED', 'Your account cannot comment.');
    if (!(await profileByAccount(env, account.id))) return apiError(400, 'E_NO_PROFILE', 'Choose your @handle on the Dashboard to comment.');
    const video = await getPostedVideo(env, onVideo[1]);
    if (!video) return apiError(404, 'E_NOT_FOUND', 'This video is not posted.');
    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = String(body?.text ?? '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return apiError(400, 'E_BAD_REQUEST', 'Write something first.');
    if (text.length > MAX_COMMENT) return apiError(400, 'E_BAD_REQUEST', `A comment has at most ${MAX_COMMENT} characters.`);
    if ((await recentComments(env, account.id, COMMENT_WINDOW)) >= COMMENT_BURST) {
      return apiError(429, 'E_SLOW_DOWN', 'You are commenting very fast. Wait a few minutes.');
    }
    const id = await addComment(env, video.id, account.id, text);
    await notify(env, { to: video.account_id, kind: 'comment', actor: account.id, shareId: video.id, commentId: id });
    return json({ id }, 201);
  }

  const one = path.match(/^\/api\/comments\/(\d{1,12})$/);
  if (one && method === 'DELETE') {
    const account = await signedInAccount(env, request);
    if (!account) return apiError(401, 'E_SIGN_IN', 'Sign in first.');
    const comment = await getComment(env, Number(one[1]));
    if (!comment) return apiError(404, 'E_NOT_FOUND', 'No such comment.');
    const video = await getShare(env, comment.share_id);
    if (comment.account_id !== account.id && video?.account_id !== account.id) {
      return apiError(403, 'E_FORBIDDEN', 'Only its author or the video’s creator can delete a comment.');
    }
    await deleteComment(env, comment.id);
    return json({ ok: true });
  }

  if (path === '/api/reports' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = String(body?.kind ?? '') as ReportKind;
    const reason = String(body?.reason ?? '') as ReportReason;
    const details = String(body?.details ?? '').trim().slice(0, 1000) || null;
    if (!REPORT_KINDS.includes(kind) || !REPORT_REASONS.includes(reason)) return apiError(400, 'E_BAD_REQUEST', 'Say what you report and why.');
    // The target as stored: a video id, a comment id, or a profile's account (handles can change).
    const raw = String(body?.target ?? '');
    let target: string | null = null;
    if (kind === 'video') target = (await getShare(env, raw))?.id ?? null;
    else if (kind === 'comment') target = /^\d{1,12}$/.test(raw) && (await getComment(env, Number(raw))) ? raw : null;
    else target = (await profileByHandle(env, raw.replace(/^@/, '')))?.account_id ?? null;
    if (!target) return apiError(404, 'E_NOT_FOUND', 'That is not here any more.');
    const account = await signedInAccount(env, request);
    const reporter = await reporterKey(env, request, account?.id ?? null);
    if ((await recentReports(env, reporter, 3600)) >= REPORTS_PER_HOUR) return apiError(429, 'E_SLOW_DOWN', 'Too many reports. Try again later.');
    await addReport(env, { kind, target, reporter, reason, details });
    return json({ ok: true }); // the same answer for a repeated report: nothing to learn from it
  }
  return null;
}

/** What a reported target is, for the admin queue. */
async function preview(env: Env, kind: ReportKind, target: string, base: string) {
  if (kind === 'video') {
    const v = await getShare(env, target);
    if (!v) return { gone: true };
    const p = v.account_id ? await profileByAccount(env, v.account_id) : null;
    return { title: v.title, url: `${base}/${v.id}`, thumb: v.has_thumb ? `${base}/v/${v.id}/thumb.jpg` : null, owner: p?.handle ?? null, account_id: v.account_id };
  }
  if (kind === 'comment') {
    const c = await getComment(env, Number(target));
    if (!c) return { gone: true };
    const p = await profileByAccount(env, c.account_id);
    return { text: c.text, status: c.status, url: `${base}/${c.share_id}`, owner: p?.handle ?? null, account_id: c.account_id };
  }
  const p = await profileByAccount(env, target);
  // The photo, to judge it (only while it is shown: a taken-down photo has nothing left to judge).
  const photo = p && avatarUrl(p) ? `${base}${avatarUrl(p)}` : null;
  return p
    ? { owner: p.handle, name: p.display_name, bio: p.bio, url: `${base}/@${p.handle}`, account_id: target, photo, photo_version: photo ? p.avatar : null, photo_hidden: Boolean(p.avatar_hidden) }
    : { gone: true };
}

/**
 * GET /api/admin/moderation (open reports, the most reported first, and blocked accounts) and
 * POST /api/admin/moderation {kind, target, action} with action dismiss | hide (a comment) |
 * remove (a video: taken down, never deleted; a comment) | block (the account behind it), or
 * {action: unblock, account_id}. The owner is told whenever something of theirs is taken down.
 * The caller has already checked the admin password.
 */
export async function handleModeration(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (path !== '/api/admin/moderation') return null;
  const base = await publicOrigin(env, origin);
  if (request.method === 'GET') {
    const groups = await openReports(env);
    const reports = await Promise.all(groups.map(async (g) => ({ ...g, preview: await preview(env, g.kind, g.target, base) })));
    return json({ reports, blocked: await listBlocked(env) });
  }
  if (request.method !== 'POST') return null;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? '');
  if (action === 'unblock') {
    await unblockAccount(env, String(body?.account_id ?? ''));
    return json({ ok: true });
  }
  const kind = String(body?.kind ?? '') as ReportKind;
  const target = String(body?.target ?? '');
  if (!REPORT_KINDS.includes(kind) || !target) return apiError(400, 'E_BAD_REQUEST', 'Say which report.');
  const info = (await preview(env, kind, target, base)) as { gone?: boolean; account_id?: string | null };

  if (action === 'dismiss') {
    await closeReports(env, kind, target, 'dismissed');
  } else if (action === 'hide' && kind === 'comment') {
    const c = await getComment(env, Number(target));
    await setCommentStatus(env, Number(target), 'hidden');
    if (c) await notifyOwner(env, { account_id: c.account_id }, 'removed', { what: 'comment', text: c.text, hidden: true });
    await closeReports(env, kind, target, 'actioned');
  } else if (action === 'remove' && kind === 'video') {
    // Taken down (copyright, Terms): gone from its page, the profile and the feed, but never
    // deleted: it stays in its owner's list, theirs to delete. They are told.
    const video = await getShare(env, target);
    if (video) {
      await takeDownShare(env, video.id);
      const job = await getJob(env, video.job_id).catch(() => null);
      await notifyOwner(env, video, 'removed', { what: 'video', title: video.title }, { lang: job?.ui_lang });
    }
    await closeReports(env, kind, target, 'actioned');
  } else if (action === 'remove' && kind === 'profile') {
    // The profile photo is taken down (hidden, never deleted); the owner is told.
    const owner = await profileByAccount(env, target);
    if (!owner?.avatar || owner.avatar_hidden) return apiError(400, 'E_BAD_REQUEST', 'This profile has no photo to take down.');
    // The version the moderator saw (sent back by the admin page); without it, the current one.
    const seen = Number(body?.version) || owner.avatar;
    if (!(await hideAvatar(env, target, seen))) {
      return apiError(409, 'E_PHOTO_CHANGED', 'The photo changed since you looked at it. Reload the reports and look again.');
    }
    await notifyOwner(env, { account_id: target }, 'removed', { what: 'photo' });
    await closeReports(env, kind, target, 'actioned');
  } else if (action === 'remove' && kind === 'comment') {
    const c = await getComment(env, Number(target));
    await deleteComment(env, Number(target));
    if (c) await notifyOwner(env, { account_id: c.account_id }, 'removed', { what: 'comment', text: c.text });
    await closeReports(env, kind, target, 'actioned');
  } else if (action === 'block') {
    if (!info.account_id) return apiError(400, 'E_BAD_REQUEST', 'No account to block.');
    await blockAccount(env, info.account_id, String(body?.reason ?? '').slice(0, 200) || `reported ${kind}`);
    await closeReports(env, kind, target, 'actioned');
  } else {
    return apiError(400, 'E_BAD_REQUEST', 'Unknown action.');
  }
  return json({ ok: true });
}
