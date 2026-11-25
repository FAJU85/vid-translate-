/**
 * Whose personal data a request is about, for "Download my data" and "Delete my account" (PDPL):
 * the account (signed in, or this browser's guest account), and the owner keys their jobs and
 * videos were made under ("web:<browser>", "tg:<chat>").
 */
export interface Person {
  accountId: string | null;
  owners: string[];
  telegramId: number | null;
  email: string | null;
}

/** "(account_id = ? OR owner IN (…))" for a table with both columns, and its values. */
export function ownedBy(p: Person): { sql: string; binds: unknown[] } {
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (p.accountId) (parts.push('account_id = ?'), binds.push(p.accountId));
  if (p.owners.length) (parts.push(`owner IN (${p.owners.map(() => '?').join(', ')})`), binds.push(...p.owners));
  return { sql: parts.length ? `(${parts.join(' OR ')})` : '0', binds };
}
