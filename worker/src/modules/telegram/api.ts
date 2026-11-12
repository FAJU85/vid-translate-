import type { Env } from '../../shared/env';

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type Keyboard = InlineButton[][];

const apiBase = (env: Env) => (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const methodUrl = (env: Env, method: string) => `${apiBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
export const fileUrl = (env: Env, path: string) => `${apiBase(env)}/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`;

/** Call a Bot API method. Returns `result`, or null when Telegram rejects the call. */
export async function tg<T = any>(env: Env, method: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch(methodUrl(env, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      if (!data.description?.includes('message is not modified')) {
        console.warn(`telegram ${method} failed: ${res.status} ${data.description}`);
      }
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    console.warn(`telegram ${method} error: ${(err as Error).message}`);
    return null;
  }
}

export function sendMessage(env: Env, chatId: number, text: string, keyboard?: Keyboard) {
  return tg<{ message_id: number }>(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function editMessage(env: Env, chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  return tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: keyboard ?? [] },
  });
}

/**
 * Upload a file to Telegram by streaming `source` straight through as multipart/form-data,
 * so large videos never have to fit in the Worker's memory.
 */
export async function sendFile(
  env: Env,
  method: 'sendDocument' | 'sendVideo',
  field: 'document' | 'video',
  source: Response,
  filename: string,
  fields: Record<string, string>,
): Promise<boolean> {
  const length = Number(source.headers.get('content-length'));
  if (!source.ok || !source.body || !Number.isFinite(length) || length <= 0) return false;

  const boundary = `----tarjim${crypto.randomUUID().replace(/-/g, '')}`;
  const encoder = new TextEncoder();
  let head = '';
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  const safeName = filename.replace(/["\r\n\\]/g, '_');
  const mime = source.headers.get('content-type') || 'application/octet-stream';
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${safeName}"\r\nContent-Type: ${mime}\r\n\r\n`;
  const headBytes = encoder.encode(head);
  const tailBytes = encoder.encode(`\r\n--${boundary}--\r\n`);

  const { readable, writable } = new FixedLengthStream(headBytes.length + length + tailBytes.length);
  const pump = (async () => {
    let writer = writable.getWriter();
    await writer.write(headBytes);
    writer.releaseLock();
    await source.body!.pipeTo(writable, { preventClose: true });
    writer = writable.getWriter();
    await writer.write(tailBytes);
    await writer.close();
  })();

  try {
    const [res] = await Promise.all([
      fetch(methodUrl(env, method), {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: readable,
        signal: AbortSignal.timeout(150_000),
      }),
      pump,
    ]);
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) console.warn(`telegram ${method} failed: ${res.status} ${data.description}`);
    return data.ok;
  } catch (err) {
    console.warn(`telegram ${method} upload error: ${(err as Error).message}`);
    return false;
  }
}
