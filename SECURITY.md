# Security

## Reporting a vulnerability

Please report security problems privately to the contact email shown on the site's `/privacy`
page (set on `/admin`), not in a public issue. Include what you found and how to reproduce it.
We aim to answer within a few days and to fix confirmed problems quickly.

## What is in place

- **HTTPS only:** plain HTTP is redirected; `Strict-Transport-Security` and other security
  headers on every response (Worker and `web/public/_headers`).
- **Encryption at rest:** the D1 database and R2 storage are encrypted at rest by Cloudflare.
- **Files:** videos are not in a public bucket. R2 is reached only through the Worker; private
  job files on the translation server use links signed with an expiry.
- **Sign-in:** users have no passwords (one-time email link, Google, or Telegram). Session
  tokens are stored as SHA-256 hashes. The admin page needs `ADMIN_PASSWORD` and, with
  `ADMIN_TOTP_SECRET` set, a 6-digit authenticator code; it gives a 12-hour signed token, never
  keeps the password, and blocks a connection after repeated failures.
- **Audit log:** admin sign-ins (failed ones too) and changes, admins opening an account, and
  people downloading or deleting their data, kept a year (`/admin` → Audit).
- **Data minimisation:** connections are kept as keyed fingerprints, never IP addresses.
- **Breach response:** see [docs/INCIDENT-RESPONSE.md](docs/INCIDENT-RESPONSE.md).
