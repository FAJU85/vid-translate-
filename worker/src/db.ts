import type { Env, JobRow } from './types';
import { now } from './types';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    owner TEXT NOT NULL,
    ip TEXT,
    chat_id INTEGER,
    status_message_id INTEGER,
    ui_lang TEXT NOT NULL DEFAULT 'en',
    source_kind TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT,
    duration REAL,
    src_lang TEXT NOT NULL DEFAULT 'auto',
    tgt_lang TEXT NOT NULL DEFAULT 'ar',
    detected_lang TEXT,
    mode TEXT NOT NULL DEFAULT 'soft',
    status TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    outputs TEXT,
    origin TEXT NOT NULL,
    dispatched INTEGER NOT NULL DEFAULT 0,
    dispatch_attempts INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    notified TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_owner ON jobs (owner, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS chats (
    chat_id INTEGER PRIMARY KEY,
    tgt_lang TEXT NOT NULL DEFAULT 'ar',
    pending TEXT,
    updated_at INTEGER NOT NULL
  )`,
];

let schemaReady: Promise<unknown> | null = null;

/** Creates the tables on first use, so a fresh D1 database needs no manual migration. */
export function ensureSchema(env: Env): Promise<unknown> {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function getJob(env: Env, id: string): Promise<JobRow | null> {
  return env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
}

export async function insertJob(env: Env, job: JobRow): Promise<void> {
  const cols = Object.keys(job) as (keyof JobRow)[];
  await env.DB.prepare(`INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => job[c]))
    .run();
}

export async function updateJob(env: Env, id: string, patch: Partial<JobRow>): Promise<void> {
  const cols = Object.keys(patch) as (keyof JobRow)[];
  if (!cols.length) return;
  await env.DB.prepare(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((c) => patch[c] ?? null), now(), id)
    .run();
}

export async function listJobs(env: Env, owner: string, limit = 30): Promise<JobRow[]> {
  const res = await env.DB.prepare('SELECT * FROM jobs WHERE owner = ? ORDER BY created_at DESC LIMIT ?')
    .bind(owner, limit)
    .all<JobRow>();
  return res.results;
}

export async function countRecent(env: Env, column: 'owner' | 'ip', value: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE ${column} = ? AND created_at > ? AND status != 'awaiting_upload'`,
  )
    .bind(value, now() - 3600)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function activeJobs(env: Env, owner: string): Promise<JobRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM jobs WHERE owner = ? AND status IN ('queued', 'running') ORDER BY created_at DESC`,
  )
    .bind(owner)
    .all<JobRow>();
  return res.results;
}

export interface ChatRow {
  chat_id: number;
  tgt_lang: string;
  pending: string | null;
}

export async function getChat(env: Env, chatId: number, defaultLang: string): Promise<ChatRow> {
  const row = await env.DB.prepare('SELECT * FROM chats WHERE chat_id = ?').bind(chatId).first<ChatRow>();
  return row ?? { chat_id: chatId, tgt_lang: defaultLang, pending: null };
}

export async function saveChat(env: Env, chat: ChatRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chats (chat_id, tgt_lang, pending, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET tgt_lang = excluded.tgt_lang, pending = excluded.pending, updated_at = excluded.updated_at`,
  )
    .bind(chat.chat_id, chat.tgt_lang, chat.pending, now())
    .run();
}
