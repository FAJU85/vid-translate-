#!/usr/bin/env node
// Makes a secret for two-step sign-in on /admin and shows how to add it to an authenticator app.
// Usage: node scripts/admin-2fa-secret.mjs [label]
// Then save it as a Worker secret (it is never written anywhere by this script):
//   npx wrangler secret put ADMIN_TOTP_SECRET
import { randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bytes = randomBytes(20); // 160 bits, as RFC 4226 recommends
let bits = 0;
let value = 0;
let secret = '';
for (const b of bytes) {
  value = (value << 8) | b;
  bits += 8;
  while (bits >= 5) {
    secret += alphabet[(value >>> (bits - 5)) & 31];
    bits -= 5;
  }
}
if (bits > 0) secret += alphabet[(value << (5 - bits)) & 31];

const label = encodeURIComponent(process.argv[2] || 'KAVOX admin');
const uri = `otpauth://totp/${label}?secret=${secret}&issuer=KAVOX&algorithm=SHA1&digits=6&period=30`;
console.log(`
Two-step sign-in secret for /admin (keep it private, do not commit it):

  ${secret}

1. In your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…),
   add an account "by key" with the secret above, time-based, 6 digits. Or open this link on the
   phone, or turn it into a QR code with any offline tool:
   ${uri}
2. Save it on the Worker:   npx wrangler secret put ADMIN_TOTP_SECRET   (paste the secret)
3. Sign in on /admin: password, then the 6-digit code from the app.

To turn two-step sign-in off again: npx wrangler secret delete ADMIN_TOTP_SECRET
`);
