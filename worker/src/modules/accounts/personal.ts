import type { Env } from '../../shared/env';
import type { Person } from '../../shared/person';
import { currentAccount } from './auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose data a request is about: the signed-in account, or this browser's guest account (never
 * made here). The owners are the keys their jobs and videos were made under. Null: nobody.
 */
export async function personFor(env: Env, request: Request, clientId: string | null): Promise<Person | null> {
  const signedIn = await currentAccount(env, request);
  const guestClient = clientId && UUID.test(clientId) ? clientId : null;
  const account =
    signedIn ?? (guestClient ? await env.DB.prepare('SELECT * FROM accounts WHERE guest_client = ?').bind(guestClient).first<Record<string, any>>() : null);
  if (!account && !guestClient) return null;
  const owners = new Set<string>();
  if (account?.guest_client) owners.add(`web:${account.guest_client}`);
  if (account?.telegram_id) owners.add(`tg:${account.telegram_id}`);
  if (!signedIn && guestClient) owners.add(`web:${guestClient}`);
  return { accountId: account?.id ?? null, owners: [...owners], telegramId: account?.telegram_id ?? null, email: account?.email ?? null };
}

/** The account itself, its credits and their history, and payments, for "Download my data". */
export async function exportAccount(env: Env, p: Person) {
  if (!p.accountId) return null;
  const id = p.accountId;
  const account = await env.DB.prepare(
    'SELECT id, name, email, email_verified, google_sub IS NOT NULL AS google, telegram_id, consent_version, consent_at, created_at, last_seen FROM accounts WHERE id = ?',
  )
    .bind(id)
    .first();
  const all = async (sql: string) => (await env.DB.prepare(sql).bind(id).all()).results;
  return {
    account,
    credits: await all('SELECT bucket, seconds, expires_at FROM credit_buckets WHERE account_id = ?'),
    credit_history: await all('SELECT job_id, kind, seconds, detail, created_at FROM credit_ledger WHERE account_id = ? ORDER BY created_at DESC'),
    payments: await all('SELECT provider, product, amount, currency, created_at FROM payments WHERE account_id = ? ORDER BY created_at DESC'),
    own_video_ending_uploaded: Boolean(env.MEDIA && (await env.MEDIA.head(`outros/${id}`))),
  };
}

/**
 * Delete the account for good: sign-ins, sign-in codes, credits and their history, the uploaded
 * video ending, then the account itself. Payment records are kept (without the account) only as
 * long as accounting law requires.
 */
export async function eraseAccount(env: Env, p: Person): Promise<void> {
  if (!p.accountId) return;
  const id = p.accountId;
  if (env.MEDIA) await env.MEDIA.delete(`outros/${id}`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id),
    ...(p.email ? [env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(p.email)] : []),
    ...(p.telegramId ? [env.DB.prepare('DELETE FROM login_codes WHERE telegram_id = ?').bind(p.telegramId)] : []),
    env.DB.prepare('DELETE FROM credit_buckets WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM credit_ledger WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM credit_holds WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id),
  ]);
}

/** Change the name shown for the account (PDPL: correct your data). */
export const renameAccount = (env: Env, accountId: string, name: string | null) =>
  env.DB.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, accountId).run();
