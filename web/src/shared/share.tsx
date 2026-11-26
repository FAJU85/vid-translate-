import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { countGrowth } from './growth';
import { t } from './i18n';

/** The link as shared to one app: it says where it went (?ref=wa), counted when someone arrives by it. */
export const tagged = (url: string, ref: string) => `${url}${url.includes('?') ? '&' : '?'}ref=${ref}`;

/** Where a link can be shared with one tap: each app's own "share this" address (no account or key needed). */
export function shareTargets(url: string, text: string) {
  return [
    { id: 'whatsapp', name: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${text} ${tagged(url, 'wa')}`)}`, tone: 'bg-[#25D366] text-[#06210F]' },
    { id: 'x', name: 'X', href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(tagged(url, 'x'))}`, tone: 'bg-black text-white ring-1 ring-slate-600' },
    { id: 'telegram', name: 'Telegram', href: `https://t.me/share/url?url=${encodeURIComponent(tagged(url, 'tg'))}&text=${encodeURIComponent(text)}`, tone: 'bg-[#229ED9] text-[#04192A]' },
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
      await navigator.clipboard.writeText(tagged(url, 'copy'));
      countGrowth('share', 'copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('Copy this link'), tagged(url, 'copy'));
    }
  }
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const pill = `flex items-center gap-1.5 ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'} rounded-lg font-semibold`;
  return (
    <div className="flex flex-wrap gap-2">
      {shareTargets(url, text).map((s) => (
        <a key={s.id} href={s.href} target="_blank" rel="noreferrer" onClick={() => countGrowth('share', s.id)} className={`${pill} ${s.tone} hover:opacity-90`} aria-label={t('Share on {app}', { app: s.name })}>
          {s.name}
        </a>
      ))}
      <button type="button" onClick={copy} className={`${pill} bg-amber-400 hover:bg-amber-300 text-slate-950`}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? t('Copied') : t('Copy link')}
      </button>
      {canShare && (
        <button
          type="button"
          onClick={() => navigator.share({ title: text, url: tagged(url, 'native') }).then(() => countGrowth('share', 'native')).catch(() => {})}
          className={`${pill} border border-slate-700 text-slate-200 hover:bg-slate-800`}
        >
          <Share2 className="w-4 h-4" /> {t('More')}
        </button>
      )}
    </div>
  );
}

/**
 * The moment the video is ready: post the video file itself. On a phone this opens the system share
 * sheet with the file, so it goes straight into TikTok, Instagram (Reels, Stories), WhatsApp Status,
 * Snapchat or YouTube Shorts, with the link in the caption. Where files cannot be shared (most
 * computers), the video is downloaded and the caption copied, ready to paste.
 */
export function ShareVideoFile({ pageUrl, title, brand }: { pageUrl: string; title: string; brand: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const id = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  const fileUrl = `/v/${encodeURIComponent(id)}/video.mp4`; // this site's own copy: no cross-site download
  const caption = `${title} · ${t('Made with {brand}', { brand })} ${tagged(pageUrl, 'file')}`;
  const canShareFiles =
    typeof navigator !== 'undefined' && 'canShare' in navigator && navigator.canShare?.({ files: [new File([''], 'v.mp4', { type: 'video/mp4' })] });

  async function shareFile() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await (await fetch(fileUrl)).blob();
      const name = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'video'}.mp4`;
      await navigator.share({ files: [new File([blob], name, { type: 'video/mp4' })], text: caption });
      countGrowth('share', 'file');
    } catch (err) {
      // Closing the share sheet is not an error; anything else falls back to downloading.
      if ((err as Error)?.name !== 'AbortError') setNote(t('Sharing the file did not work here: download it, then post it from your phone.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setNote(t('Caption copied: paste it when you post the video.'));
    } catch {
      window.prompt(t('Copy this link'), caption);
    }
  }

  return (
    <div className="p-4 rounded-xl border border-amber-400/40 bg-amber-400/10 space-y-3">
      <div>
        <div className="text-sm font-bold text-white">{t('Your video is ready. Post it!')}</div>
        <p className="text-xs text-slate-300">{t('TikTok, Instagram Reels, YouTube Shorts, WhatsApp Status, Snapchat: the video goes with its link, so people can make their own.')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canShareFiles && (
          <button type="button" onClick={shareFile} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-sm font-bold disabled:opacity-60">
            <Share2 className="w-4 h-4" /> {busy ? t('Preparing the video…') : t('Share the video')}
          </button>
        )}
        <a
          href={`${fileUrl}?download=1`}
          onClick={() => countGrowth('share', 'download')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${canShareFiles ? 'border border-slate-600 text-slate-100 hover:bg-slate-800' : 'bg-amber-400 hover:bg-amber-300 text-slate-950'}`}
        >
          {t('Download the video')}
        </a>
        <button type="button" onClick={copyCaption} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-600 text-sm text-slate-100 hover:bg-slate-800">
          <Copy className="w-4 h-4" /> {t('Copy the caption')}
        </button>
      </div>
      {note && <p className="text-xs text-amber-100">{note}</p>}
    </div>
  );
}
