const encoder = new TextEncoder();

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}

/** Query string for a signed link: `scope` is e.g. "file:<job>:<name>". Mirrors backend/app/security.py. */
export async function signedQuery(secret: string, scope: string, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `exp=${exp}&sig=${await hmacHex(secret, `${scope}:${exp}`)}`;
}

export async function verifySigned(secret: string, scope: string, exp: string | null, sig: string | null): Promise<boolean> {
  const expNum = Number(exp);
  if (!exp || !sig || !Number.isFinite(expNum) || expNum < Date.now() / 1000) return false;
  return safeEqual(await hmacHex(secret, `${scope}:${expNum}`), sig);
}
