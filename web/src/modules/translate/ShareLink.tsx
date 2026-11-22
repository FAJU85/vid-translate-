import { useState } from 'react';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';

/** The video's own public page: copy the link, open it, or share it with the phone's share sheet. */
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', url);
    }
  }
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="p-3 rounded-xl border border-slate-700 bg-slate-950 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Share2 className="w-4 h-4 text-amber-400" /> Share link
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Share link"
          className="flex-1 min-w-[12rem] px-3 py-2 text-sm rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
        />
        <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-amber-400 hover:bg-amber-300 font-semibold text-slate-950">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
        </button>
        {canShare && (
          <button
            onClick={() => navigator.share({ url }).catch(() => {})}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800"
          >
            <Share2 className="w-4 h-4" /> Share
          </button>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">
          <ExternalLink className="w-4 h-4" /> Open
        </a>
      </div>
      <p className="text-xs text-slate-500">Anyone with the link can watch it. Free accounts’ links last 30 days; monthly plans keep theirs.</p>
    </div>
  );
}
