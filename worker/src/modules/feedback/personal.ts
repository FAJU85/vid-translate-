import type { Env } from '../../shared/env';
import type { Person } from '../../shared/person';

const who = (p: Person) => {
  const senders = [...(p.accountId ? [`acct:${p.accountId}`] : []), ...(p.telegramId ? [`tg:${p.telegramId}`] : [])];
  const parts = [...(p.accountId ? ['account_id = ?'] : []), ...(senders.length ? [`sender IN (${senders.map(() => '?').join(', ')})`] : [])];
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '0', binds: [...(p.accountId ? [p.accountId] : []), ...senders] };
};

export async function exportFeedback(env: Env, p: Person) {
  const w = who(p);
  return (await env.DB.prepare(`SELECT source, text, page, status, created_at FROM feedback WHERE ${w.sql} ORDER BY created_at DESC`).bind(...w.binds).all()).results;
}

export async function eraseFeedback(env: Env, p: Person): Promise<void> {
  const w = who(p);
  await env.DB.prepare(`DELETE FROM feedback WHERE ${w.sql}`).bind(...w.binds).run();
}
