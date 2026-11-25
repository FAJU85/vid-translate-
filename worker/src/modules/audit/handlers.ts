import type { Env } from '../../shared/env';
import { json } from '../../shared/http';
import { listAudit } from './store';

/** GET /api/admin/audit(?action=admin.&before=<id>): the newest entries first. The caller checks the admin. */
export async function handleAuditAdmin(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/admin/audit' || request.method !== 'GET') return null;
  const url = new URL(request.url);
  const before = Number(url.searchParams.get('before')) || null;
  const items = await listAudit(env, { action: url.searchParams.get('action'), before, limit: 200 });
  return json({ items, next: items.length === 200 ? items[items.length - 1].id : null });
}
