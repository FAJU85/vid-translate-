/**
 * Anonymous growth counts (the Worker's growth brick): a visit and where it came from, a share and
 * to which app, an install. Only daily totals are kept, nothing about the person: no cookie, no
 * id. A count that cannot be sent is simply lost.
 */
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export type GrowthKind = 'visit' | 'share' | 'install';

export function countGrowth(kind: GrowthKind, source: string): void {
  try {
    void fetch(`${BASE}/api/growth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, source }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* offline or blocked: not counted */
  }
}

// Sites people arrive from, by a part of their address: one name per kind of place.
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)google\./, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)(duckduckgo|yahoo|yandex|baidu)\./, 'search'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'wa'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'tg'],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'x'],
  [/(^|\.)(facebook\.com|fb\.com|m\.facebook\.com|l\.facebook\.com)$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
];

/**
 * Where this visit came from: the link's own tag (?ref=wa, ?utm_source=…), the installed app
 * (?source=app), the site that linked here, or "direct".
 */
export function visitSource(url: URL, referrer: string): string {
  if (url.searchParams.get('invite')) return 'invite';
  const tag = url.searchParams.get('ref') || url.searchParams.get('utm_source');
  if (tag) return tag.toLowerCase().slice(0, 40);
  if (url.searchParams.get('source') === 'app' || window.matchMedia?.('(display-mode: standalone)').matches) return 'app';
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host || host === url.hostname) return 'direct';
    return REFERRERS.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '').slice(0, 40);
  } catch {
    return 'direct';
  }
}

/** Count this visit once per browser tab session. */
export function countVisit(): void {
  try {
    if (sessionStorage.getItem('kavox_visit')) return;
    sessionStorage.setItem('kavox_visit', '1');
  } catch {
    /* storage blocked: counted each load, which is fine */
  }
  countGrowth('visit', visitSource(new URL(window.location.href), document.referrer));
}
