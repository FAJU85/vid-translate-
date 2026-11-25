import { ExternalLink, Share2 } from 'lucide-react';
import { t } from '../../shared/i18n';
import { ShareButtons } from '../../shared/share';

/** The video's own public page: share it to WhatsApp, X or Telegram, copy the link, or open it. */
export function ShareLink({ url, title }: { url: string; title?: string | null }) {
  return (
    <div className="p-3 rounded-xl border border-slate-700 bg-slate-950 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Share2 className="w-4 h-4 text-amber-400" />{' '}{t("Share link")}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          dir="ltr"
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label={t("Share link")}
          className="flex-1 min-w-[12rem] px-3 py-2 text-sm rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
        />
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">
          <ExternalLink className="w-4 h-4" />{' '}{t("Open")}
        </a>
      </div>
      <ShareButtons url={url} text={title || t('Watch this video in your language')} />
      <p className="text-xs text-slate-500">{t("Anyone with the link can watch it. Free accounts’ links last 30 days; monthly plans keep theirs.")}</p>
    </div>
  );
}
