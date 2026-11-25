import { Bot, ExternalLink } from 'lucide-react';
import type { AppConfig } from '../../shared/api';
import { SITE } from '../../shared/content';
import { t } from '../../shared/i18n';


export function TelegramView({ config }: { config: AppConfig | null }) {
  const username = config?.bot_username;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{SITE.telegram.title}</h1>
        <p className="mt-1 text-sm text-slate-400">{SITE.telegram.intro}</p>
      </div>

      {username ? (
        <a
          href={`https://t.me/${username}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold"
        >
          <Bot className="w-5 h-5" />
          {t("Open @")}{username}
          <ExternalLink className="w-4 h-4" />
        </a>
      ) : (
        <p className="p-3 text-sm rounded-xl border border-slate-800 bg-slate-900 text-slate-300">
          {config ? t("The Telegram bot is not connected yet.") : t("Loading…")}
        </p>
      )}

      <ol className="space-y-3">
        {SITE.telegram.steps.map(({ title, body: text }, i) => (
          <li key={i} className="flex gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900">
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
        {t("Commands:")}{' '}<code className="text-amber-300">{t("/lang")}</code>{' '}{t("target language ·")}{' '}
        <code className="text-amber-300">{t("/status")}</code>{' '}{t("recent jobs ·")}{' '}<code className="text-amber-300">{t("/cancel")}</code>{' '}{t("stop the running job")}
      </div>
    </div>
  );
}
