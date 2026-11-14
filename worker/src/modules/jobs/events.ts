import type { Env } from '../../shared/env';
import type { JobRow } from './model';

/**
 * Port through which other bricks follow jobs without the jobs brick depending on them.
 * The base registers listeners (e.g. the Telegram brick) at start-up.
 */
export interface JobListener {
  /** Progress, failure, cancellation, or "waiting for the backend" changed. */
  changed(env: Env, job: JobRow): Promise<void>;
  /** The job finished successfully and its outputs are ready. */
  finished(env: Env, job: JobRow): Promise<void>;
}

const listeners: JobListener[] = [];

export function registerJobListener(listener: JobListener): void {
  if (!listeners.includes(listener)) listeners.push(listener);
}

async function emit(kind: keyof JobListener, env: Env, job: JobRow): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener[kind](env, job);
    } catch (err) {
      // A listener's failure must never undo or block the job's own state change.
      console.error(`job listener ${kind} failed for ${job.id}`, (err as Error).stack ?? err);
    }
  }
}

export const emitChanged = (env: Env, job: JobRow) => emit('changed', env, job);
export const emitFinished = (env: Env, job: JobRow) => emit('finished', env, job);

/**
 * Port through which another brick supplies a job's source file, e.g. the Telegram brick for files
 * sent to the bot. The Worker uploads it to the Space itself: the Space cannot reliably open
 * connections to the Worker, so it is never asked to fetch anything from it.
 */
export interface SourceFile {
  body: ReadableStream<Uint8Array>;
  /** Size in bytes, when known. */
  length: number | null;
}
export type SourceFetcher = (env: Env, job: JobRow) => Promise<SourceFile | null>;

const sourceFetchers = new Map<string, SourceFetcher>();

export function registerSourceFetcher(sourceKind: string, fetcher: SourceFetcher): void {
  sourceFetchers.set(sourceKind, fetcher);
}

export const sourceFetcher = (sourceKind: string): SourceFetcher | undefined => sourceFetchers.get(sourceKind);
