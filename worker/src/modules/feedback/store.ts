import { now, type Env } from '../../shared/env';

/** What people tell KAVOX: from the website's "Send feedback" or the bot's /feedback. */
export const FEEDBACK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    sender TEXT NOT NULL,
    account_id TEXT,
    text TEXT NOT NULL,
    page TEXT,
    lang TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS feedback_status ON feedback (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS feedback_sender ON feedback (sender, created_at)`,
];

export type FeedbackSource = 'web' | 'telegram';
export type FeedbackStatus = 'new' | 'done';

export interface FeedbackRow {
  id: number;
  source: FeedbackSource;
  sender: string;
  account_id: string | null;
  text: string;
  page: string | null;
  lang: string | null;
  status: FeedbackStatus;
  created_at: number;
}

export async function addFeedback(
  env: Env,
  f: { source: FeedbackSource; sender: string; account_id: string | null; text: string; page: string | null; lang: string | null },
): Promise<number> {
  const res = await env.DB.prepare('INSERT INTO feedback (source, sender, account_id, text, page, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(f.source, f.sender, f.account_id, f.text, f.page, f.lang, now())
    .run();
  return Number(res.meta.last_row_id);
}

/** How much one sender sent in the last `seconds` (the rate limit). */
export async function recentFeedback(env: Env, sender: string, seconds: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE sender = ? AND created_at > ?').bind(sender, now() - seconds).first<{ n: number }>();
  return row?.n ?? 0;
}

/** The newest first; `status` narrows it to new or done. */
export async function listFeedback(env: Env, status: FeedbackStatus | null, limit = 200): Promise<FeedbackRow[]> {
  const where = status ? 'WHERE status = ?' : '';
  const stmt = env.DB.prepare(`SELECT * FROM feedback ${where} ORDER BY created_at DESC, id DESC LIMIT ?`);
  return (await (status ? stmt.bind(status, limit) : stmt.bind(limit)).all<FeedbackRow>()).results;
}

export async function feedbackCounts(env: Env): Promise<Record<FeedbackStatus, number>> {
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status').all<{ status: FeedbackStatus; n: number }>();
  const counts: Record<FeedbackStatus, number> = { new: 0, done: 0 };
  for (const r of results) counts[r.status] = r.n;
  return counts;
}

export const setFeedbackStatus = (env: Env, id: number, status: FeedbackStatus) =>
  env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(status, id).run();

export const deleteFeedback = (env: Env, id: number) => env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();

/** Feedback is kept at most a year (the Privacy Policy's promise): older messages are deleted. */
export const sweepFeedback = (env: Env) =>
  env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(now() - 365 * 86400).run();
