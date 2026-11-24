/**
 * @handle rules: 3 to 24 characters, lower-case letters, digits, "_" and "." ("." not first, last
 * or twice in a row), and not a word KAVOX uses itself or that could pass for staff.
 */
export const HANDLE = /^(?=.{3,24}$)[a-z0-9_](?:[a-z0-9_]|\.(?!\.))*[a-z0-9_]$/;

const RESERVED = new Set([
  'admin', 'administrator', 'api', 'v', 'kavox', 'support', 'help', 'root', 'system', 'staff', 'moderator', 'mod',
  'official', 'team', 'telegram', 'bot', 'settings', 'account', 'accounts', 'login', 'logout', 'signin', 'signup',
  'register', 'about', 'terms', 'privacy', 'feed', 'explore', 'search', 'following', 'for_you', 'foryou', 'trending',
  'null', 'undefined', 'www', 'mail', 'email', 'security', 'billing', 'pricing', 'dashboard', 'me', 'you', 'everyone',
]);

/** Days between two changes of a handle (so handles are not passed around or squatted). */
export const HANDLE_CHANGE_DAYS = 7;

export type HandleProblem = 'invalid' | 'reserved';

/** The handle as stored (lower case, without "@"), or why it cannot be used. */
export function checkHandle(raw: string): { handle: string } | { problem: HandleProblem } {
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return { problem: 'invalid' };
  if (RESERVED.has(handle) || /kavox|admin|official|support/.test(handle.replace(/[._]/g, ''))) return { problem: 'reserved' };
  return { handle };
}
