import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { t } from './i18n';

/** Where a link can be shared with one tap: each app's own "share this" address (no account or key needed). */
export function shareTargets(url: string, text: string) {
  const u = encodeURIComponent(url);
  const both = encodeURIComponent(`${text} ${url}`);
  return [
    { id: 'whatsapp', name: 'WhatsApp', href: `https://wa.me/?text=${both}`, tone: 'bg-[#25D366] text-[#06210F]' },
    { id: 'x', name: 'X', href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${u}`, tone: 'bg-black text-white ring-1 ring-slate-600' },
    { id: 'telegram', name: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text)}`, tone: 'bg-[#229ED9] text-[#04192A]' },
  ] as const;
}

/**
 * Share buttons: WhatsApp, X, Telegram, copy the link, and (on phones) the system share sheet.
 * The link's page carries the picture and title the apps show in their preview.
 */
export function ShareButtons({ url, text, compact = false }: { url: string; text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('Copy this link'), url);
    }
  }
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const pill = `flex items-center gap-1.5 ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'} rounded-lg font-semibold`;
  return (
    <div className="flex flex-wrap gap-2">
      {shareTargets(url, text).map((s) => (
        <a key={s.id} href={s.href} target="_blank" rel="noreferrer" className={`${pill} ${s.tone} hover:opacity-90`} aria-label={t('Share on {app}', { app: s.name })}>
          {s.name}
        </a>
      ))}
      <button type="button" onClick={copy} className={`${pill} bg-amber-400 hover:bg-amber-300 text-slate-950`}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? t('Copied') : t('Copy link')}
      </button>
      {canShare && (
        <button
          type="button"
          onClick={() => navigator.share({ title: text, url }).catch(() => {})}
          className={`${pill} border border-slate-700 text-slate-200 hover:bg-slate-800`}
        >
          <Share2 className="w-4 h-4" /> {t('More')}
        </button>
      )}
    </div>
  );
}
