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

/**
 * Port through which another brick (accounts) chooses the ending added to a job's rendered video:
 * the KAVOX clip, the subscriber's own (sent to the Space with the job) or none.
 */
export type OutroChoice = { kind: 'kavox' } | { kind: 'none' } | { kind: 'custom'; file: SourceFile };
export type OutroChooser = (env: Env, job: JobRow) => Promise<OutroChoice>;

let outroChooser: OutroChooser | null = null;

export function registerOutroChooser(chooser: OutroChooser): void {
  outroChooser = chooser;
}

/**
 * Port through which another brick (learning) supplies a job's translation memory: the rules,
 * learned from people's corrections or written by an admin, the Space applies before its model.
 */
export type MemoryProvider = (env: Env, job: JobRow) => Promise<Record<string, unknown> | null>;

let memoryProvider: MemoryProvider | null = null;

export function registerMemoryProvider(provider: MemoryProvider): void {
  memoryProvider = provider;
}

/** A job's translation memory; none when nothing is learned yet or it cannot be read. */
export async function memoryFor(env: Env, job: JobRow): Promise<Record<string, unknown> | null> {
  if (!memoryProvider) return null;
  try {
    return await memoryProvider(env, job);
  } catch (err) {
    console.error('reading the translation memory failed for', job.id, (err as Error).stack ?? err);
    return null;
  }
}

/**
 * Port through which another brick (learning) says which download methods to try first for a
 * link job, learned from how every download from that site went.
 */
export type DownloadPlanner = (env: Env, job: JobRow) => Promise<string[] | null>;

let downloadPlanner: DownloadPlanner | null = null;

export function registerDownloadPlanner(planner: DownloadPlanner): void {
  downloadPlanner = planner;
}

/** The methods to try first for a link job; none when nothing is learned or it cannot be read. */
export async function downloadPlan(env: Env, job: JobRow): Promise<string[] | null> {
  if (!downloadPlanner) return null;
  try {
    return await downloadPlanner(env, job);
  } catch (err) {
    console.error('reading the download methods failed for', job.id, (err as Error).stack ?? err);
    return null;
  }
}

/**
 * Port through which another brick (settings) supplies the site's logo for lyrics videos (sound
 * alone made into a video): base64 image bytes, or null when it is switched off or there is none.
 */
export type LogoProvider = (env: Env) => Promise<string | null>;

let logoProvider: LogoProvider | null = null;

export function registerLogoProvider(provider: LogoProvider): void {
  logoProvider = provider;
}

/** The logo for a job's lyrics video; none when switched off, missing or unreadable. */
export async function logoFor(env: Env, job: JobRow): Promise<string | null> {
  if (!logoProvider || job.mode !== 'hard') return null;
  try {
    return await logoProvider(env);
  } catch (err) {
    console.error('reading the logo failed for', job.id, (err as Error).stack ?? err);
    return null;
  }
}

/** The ending for a job; the KAVOX one when nothing else is chosen or the choice fails. */
export async function chooseOutro(env: Env, job: JobRow): Promise<OutroChoice> {
  if (!outroChooser) return { kind: 'kavox' };
  try {
    return await outroChooser(env, job);
  } catch (err) {
    console.error('choosing the ending failed for', job.id, (err as Error).stack ?? err);
    return { kind: 'kavox' };
  }
}
