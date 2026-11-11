import { Bot, ExternalLink } from 'lucide-react';
import type { AppConfig } from '../lib/api';

const STEPS = [
  ['Open the bot and press Start', 'It explains what it can do, in English or Arabic depending on your Telegram language.'],
  ['Send a video link or a file', 'Links from YouTube, X, TikTok, Instagram and direct files work. Files sent in the chat can be up to 20 MB (a Telegram limit); use a link or this website for larger videos.'],
  ['Choose what you want back', 'A subtitle file (.srt), or the video with the subtitles burned into the picture. Use /lang to change the target language.'],
  ['Wait for the result', 'The bot shows live progress and sends the files into the chat when they are ready.'],
];

export function TelegramView({ config }: { config: AppConfig | null }) {
  const username = config?.bot_username;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Use it from Telegram</h1>
        <p className="mt-1 text-sm text-slate-400">The same translation service, without leaving your chat app.</p>
      </div>

      {username ? (
        <a
          href={`https://t.me/${username}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold"
        >
          <Bot className="w-5 h-5" />
          Open @{username}
          <ExternalLink className="w-4 h-4" />
        </a>
      ) : (
        <p className="p-3 text-sm rounded-xl border border-slate-800 bg-slate-900 text-slate-300">
          {config ? 'The Telegram bot is not connected yet.' : 'Loading…'}
        </p>
      )}

      <ol className="space-y-3">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="flex gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900">
            <span className="w-7 h-7 shrink-0 rounded-full bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center">
              {i + 1}
            </span>
            <div>
              <div className="font-semibold text-white">{title}</div>
              <p className="text-sm text-slate-400 mt-0.5">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="text-sm text-slate-400">
        Commands: <code className="text-amber-300">/lang</code> target language ·{' '}
        <code className="text-amber-300">/status</code> recent jobs · <code className="text-amber-300">/cancel</code> stop
        the running job
      </div>
    </div>
  );
}
