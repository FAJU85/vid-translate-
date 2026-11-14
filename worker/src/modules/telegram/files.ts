import type { Env } from '../../shared/env';
import type { JobRow, SourceFile } from '../jobs';
import { fileUrl, tg } from './api';

/**
 * Fetch the file a user sent to the bot. Registered with the jobs brick as the source of
 * 'telegram' jobs: the Worker uploads it to the Space, which cannot reach Telegram itself.
 */
export async function fetchTelegramFile(env: Env, job: JobRow): Promise<SourceFile | null> {
  const file = await tg<{ file_path?: string; file_size?: number }>(env, 'getFile', { file_id: job.source });
  if (!file?.file_path) return null;
  const upstream = await fetch(fileUrl(env, file.file_path));
  if (!upstream.ok || !upstream.body) return null;
  const length = Number(upstream.headers.get('content-length') ?? file.file_size ?? NaN);
  return { body: upstream.body, length: Number.isFinite(length) ? length : null };
}
