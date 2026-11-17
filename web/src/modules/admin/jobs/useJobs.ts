import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, adminApi, type AdminAction, type AdminJob } from '../../../shared/api';
import { ACTION_LABEL, canDo, optimistic } from './model';
import type { Toast } from './Toasts';

const POLL_MS = 10_000;

/**
 * The dashboard's single source of truth: every view (board, table, calendar, drawer) renders
 * from these jobs. Actions are optimistic: the change shows at once and is rolled back, with a
 * toast, if the server refuses it.
 */
export function useJobs(password: string, notify: (toast: Omit<Toast, 'id'>) => void) {
  const [server, setServer] = useState<AdminJob[]>([]);
  // Optimistic changes still waiting for the server: a job, or null for a deleted one.
  const [pending, setPending] = useState<Map<string, AdminJob | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setServer(await adminApi.jobs(password));
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the jobs.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const jobs = useMemo(() => {
    if (!pending.size) return server;
    const out: AdminJob[] = [];
    for (const job of server) {
      if (!pending.has(job.id)) out.push(job);
      else {
        const shown = pending.get(job.id);
        if (shown) out.push(shown);
      }
    }
    return out;
  }, [server, pending]);

  const byId = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  /** Apply an action to the jobs it fits. Returns how many it was sent for. */
  const run = useCallback(
    async (action: AdminAction, ids: string[]): Promise<number> => {
      const targets = ids.map((id) => byId.get(id)).filter((j): j is AdminJob => !!j && canDo(action, j) && !pending.has(j.id));
      if (!targets.length) return 0;

      setPending((p) => {
        const next = new Map(p);
        for (const job of targets) next.set(job.id, optimistic(action, job));
        return next;
      });
      const settle = () =>
        setPending((p) => {
          const next = new Map(p);
          for (const job of targets) next.delete(job.id);
          return next;
        });

      try {
        const { results } = await adminApi.act(password, action, targets.map((j) => j.id));
        const ok = results.filter((r) => r.ok);
        const failed = results.filter((r) => !r.ok);
        setServer((list) => {
          const replaced = new Map(ok.map((r) => [r.id, r.job ?? null]));
          return list.flatMap((job) => {
            if (!replaced.has(job.id)) return [job];
            const next = replaced.get(job.id);
            return action === 'delete' || !next ? [] : [next];
          });
        });
        settle();
        const noun = (n: number) => `${n} job${n === 1 ? '' : 's'}`;
        if (ok.length) notify({ kind: 'success', text: `${noun(ok.length)} ${ACTION_LABEL[action].done}.` });
        if (failed.length) {
          notify({
            kind: 'error',
            text: `${noun(failed.length)} could not be ${ACTION_LABEL[action].done.replace(' again', '')}: ${(failed[0].error ?? 'refused by the server').replace(/\.$/, '')}. The change was undone.`,
          });
        }
      } catch (err) {
        settle(); // roll back every optimistic change
        notify({
          kind: 'error',
          text: `${ACTION_LABEL[action].verb} failed: ${(err instanceof ApiError ? err.message : 'no answer from the server').replace(/\.$/, '')}. Nothing was changed.`,
        });
      }
      return targets.length;
    },
    [byId, pending, password, notify],
  );

  return { jobs, byId, loading, error, loadedAt, refresh, run, pendingIds: pending };
}
