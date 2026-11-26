import { useState } from 'react';
import { Rocket, X } from 'lucide-react';
import type { SiteSettings } from '../shared/api';
import { SITE } from '../shared/content';
import { t } from '../shared/i18n';

const DISMISSED = 'kavox_ph_banner';

/**
 * Product Hunt: on launch day (admin: Product Hunt post + "launch day" on) every visitor sees that
 * KAVOX is live there, with a link to support it; someone who came from Product Hunt is welcomed
 * with the two things to try. Closed once, it stays closed for the visit.
 */
export function LaunchBanner({ site, fromPH, onTry }: { site?: SiteSettings; fromPH: boolean; onTry: (tab: 'translate' | 'lyrics') => void }) {
  const [closed, setClosed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED) === '1';
    } catch {
      return false;
    }
  });
  const live = Boolean(site?.ph_live === '1' && site?.ph_url);
  if (closed || (!live && !fromPH)) return null;
  const close = () => {
    setClosed(true);
    try {
      sessionStorage.setItem(DISMISSED, '1');
    } catch {
      /* not kept: shown again next page load */
    }
  };
  const brand = SITE.brand.name;
  return (
    <div role="region" aria-label="Product Hunt" className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 p-3 pe-10 relative rounded-xl border border-[#DA552F]/50 bg-[#DA552F]/10 text-sm text-slate-100">
      <Rocket className="w-5 h-5 text-[#FF6154] shrink-0" aria-hidden />
      <span className="flex-1 min-w-[12rem]">
        {fromPH ? <b>{t('Welcome, Product Hunt!')} </b> : null}
        {live ? t('{brand} is live on Product Hunt today.', { brand }) : null}{' '}
        {t('Free, no sign-up: translate any video, or turn a song into a lyrics video.')}
      </span>
      <span className="flex flex-wrap gap-2">
        {fromPH && (
          <>
            <button type="button" onClick={() => onTry('translate')} className="px-3 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-800">
              {t('Translate a video')}
            </button>
            <button type="button" onClick={() => onTry('lyrics')} className="px-3 py-1.5 rounded-lg border border-slate-600 hover:bg-slate-800">
              {t('Make a lyrics video')}
            </button>
          </>
        )}
        {live && (
          <a href={site!.ph_url} target="_blank" rel="noopener" className="px-3 py-1.5 rounded-lg bg-[#DA552F] hover:bg-[#c94a27] text-white font-semibold">
            {t('Support us on Product Hunt')}
          </a>
        )}
      </span>
      <button type="button" onClick={close} aria-label={t('Close')} className="absolute top-2 end-2 p-1 text-slate-400 hover:text-white">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** After launch day: a small "Featured on Product Hunt" link in the footer. */
export function ProductHuntBadge({ site }: { site?: SiteSettings }) {
  if (!site?.ph_url || site.ph_live === '1') return null;
  return (
    <>
      {' · '}
      <a href={site.ph_url} target="_blank" rel="noopener" className="hover:text-slate-300 underline-offset-2 hover:underline">
        {t('Featured on Product Hunt')}
      </a>
    </>
  );
}
