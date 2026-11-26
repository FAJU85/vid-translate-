import { useState } from 'react';
import { Gift, Heart, Info, Megaphone, Rocket, Sparkles, X } from 'lucide-react';
import type { BlockTab, SiteBlock } from './api';
import { SITE } from './content';
import { RTL, t } from './i18n';

/**
 * Banners and footer links made on /admin → Banners. The same drawing is used on the site and
 * for the admin's preview.
 */

const TONE: Record<SiteBlock['tone'], { box: string; icon: string; primary: string }> = {
  brand: { box: 'border-amber-400/40 bg-amber-400/10', icon: 'text-amber-300', primary: 'bg-amber-400 hover:bg-amber-300 text-slate-950' },
  info: { box: 'border-sky-700 bg-sky-950/60', icon: 'text-sky-300', primary: 'bg-sky-500 hover:bg-sky-400 text-slate-950' },
  success: { box: 'border-emerald-800 bg-emerald-950/60', icon: 'text-emerald-300', primary: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' },
  warning: { box: 'border-amber-700 bg-amber-950/60', icon: 'text-amber-300', primary: 'bg-amber-500 hover:bg-amber-400 text-slate-950' },
  danger: { box: 'border-rose-800 bg-rose-950/60', icon: 'text-rose-300', primary: 'bg-rose-500 hover:bg-rose-400 text-white' },
  producthunt: { box: 'border-[#DA552F]/50 bg-[#DA552F]/10', icon: 'text-[#FF6154]', primary: 'bg-[#DA552F] hover:bg-[#c94a27] text-white' },
};
const ICON = { rocket: Rocket, megaphone: Megaphone, gift: Gift, sparkles: Sparkles, info: Info, heart: Heart } as const;

/** The text in the page's language (the other one when it is empty); {brand} is the site name. */
export function pick(en: string, ar: string, arabic = RTL): string {
  return (arabic ? ar || en : en || ar).split('{brand}').join(SITE.brand.name);
}

const closedKey = (id: string) => `kavox_closed_${id}`;
function wasClosed(id: string): boolean {
  try {
    return sessionStorage.getItem(closedKey(id)) === '1';
  } catch {
    return false;
  }
}

/** One banner. `arabic` (the admin preview) picks the language; on the site it follows the page. */
export function BlockBanner({ block, onTab, onClose, arabic = RTL }: { block: SiteBlock; onTab?: (tab: BlockTab) => void; onClose?: () => void; arabic?: boolean }) {
  const tone = TONE[block.tone] ?? TONE.brand;
  const Icon = block.icon !== 'none' ? ICON[block.icon] : null;
  const title = pick(block.title_en, block.title_ar, arabic);
  const text = pick(block.text_en, block.text_ar, arabic);
  const buttons = block.buttons.filter((b) => b.tab || b.url);
  const look = (primary?: boolean) => `px-3 py-1.5 rounded-lg ${primary ? `${tone.primary} font-semibold` : 'border border-slate-600 hover:bg-slate-800'}`;
  return (
    <div
      role="region"
      aria-label={title || text}
      dir={arabic ? 'rtl' : 'ltr'}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 relative rounded-xl border text-sm text-slate-100 ${block.dismissible ? 'pe-10' : ''} ${tone.box}`}
    >
      {Icon && <Icon className={`w-5 h-5 shrink-0 ${tone.icon}`} aria-hidden />}
      <span className="flex-1 min-w-[12rem]">
        {title && <b>{title} </b>}
        {text}
      </span>
      {buttons.length > 0 && (
        <span className="flex flex-wrap gap-2">
          {buttons.map((b, i) =>
            b.tab ? (
              <button key={i} type="button" onClick={() => onTab?.(b.tab!)} className={look(b.primary)}>
                {pick(b.label_en, b.label_ar, arabic)}
              </button>
            ) : (
              <a key={i} href={b.url} {...(b.url!.startsWith('/') ? {} : { target: '_blank', rel: 'noopener' })} className={look(b.primary)}>
                {pick(b.label_en, b.label_ar, arabic)}
              </a>
            ),
          )}
        </span>
      )}
      {block.dismissible && (
        <button type="button" onClick={onClose} aria-label={t('Close')} className="absolute top-2 end-2 p-1 text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

const forVisitor = (b: SiteBlock, source: string) => b.sources.length === 0 || b.sources.includes(source);

/** The banners for this page (`place`: a tab), every-page ones first, in the admin's order. */
export function SiteBanners({ blocks, tab, source, onTab }: { blocks?: SiteBlock[]; tab: string; source: string; onTab: (tab: BlockTab) => void }) {
  const [closed, setClosed] = useState<string[]>([]);
  const shown = (blocks ?? []).filter((b) => (b.place === 'top' || b.place === tab) && forVisitor(b, source) && !closed.includes(b.id) && !wasClosed(b.id));
  if (!shown.length) return null;
  const close = (id: string) => {
    setClosed((c) => [...c, id]);
    try {
      sessionStorage.setItem(closedKey(id), '1');
    } catch {
      /* not kept: shown again next page load */
    }
  };
  return (
    <div className="mb-6 space-y-3">
      {shown.map((b) => (
        <BlockBanner key={b.id} block={b} onTab={onTab} onClose={() => close(b.id)} />
      ))}
    </div>
  );
}

/** Footer links, each after a " · ". */
export function FooterLinks({ blocks, source }: { blocks?: SiteBlock[]; source: string }) {
  const links = (blocks ?? []).filter((b) => b.place === 'footer' && b.url && forVisitor(b, source));
  return (
    <>
      {links.map((b) => (
        <span key={b.id}>
          {' · '}
          <a href={b.url} {...(b.url.startsWith('/') ? {} : { target: '_blank', rel: 'noopener' })} className="hover:text-slate-300 underline-offset-2 hover:underline">
            {pick(b.text_en, b.text_ar)}
          </a>
        </span>
      ))}
    </>
  );
}
