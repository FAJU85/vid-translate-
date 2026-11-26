/**
 * Banners and footer links, made on the /admin page (Banners): each one can be added, edited,
 * duplicated, deleted, reordered, turned on and off, and limited to dates and to visitors from
 * a source (?ref=producthunt). Kept as one JSON list in the settings table ("blocks").
 */

export const PLACES = ['top', 'translate', 'lyrics', 'feed', 'telegram', 'dashboard', 'footer'] as const;
export const TABS = ['translate', 'lyrics', 'feed', 'telegram', 'dashboard'] as const;
export const TONES = ['brand', 'info', 'success', 'warning', 'danger', 'producthunt'] as const;
export const ICONS = ['none', 'rocket', 'megaphone', 'gift', 'sparkles', 'info', 'heart'] as const;

export interface BlockButton {
  label_en: string;
  label_ar: string;
  /** Opens a page of the site… */
  tab?: (typeof TABS)[number];
  /** …or an address (https://… or /path). Empty: the button is hidden. */
  url?: string;
  primary?: boolean;
}

export interface Block {
  id: string;
  /** Only for the admin list. */
  name: string;
  enabled: boolean;
  /** Top of every page, top of one page, or a link in the footer. */
  place: (typeof PLACES)[number];
  /** Empty: everyone. Otherwise only visitors who arrived from one of these (?ref=… or the site). */
  sources: string[];
  /** YYYY-MM-DD (UTC), inclusive; empty: no limit. */
  start: string;
  end: string;
  tone: (typeof TONES)[number];
  icon: (typeof ICONS)[number];
  title_en: string;
  title_ar: string;
  text_en: string;
  text_ar: string;
  buttons: BlockButton[];
  /** The visitor can close it (for the rest of the visit). */
  dismissible: boolean;
  /** Footer links: where the link goes. */
  url: string;
}

export const MAX_BLOCKS = 30;
const MAX_BUTTONS = 3;

/** Until the admin saves the list, these are the banners (the Product Hunt launch). */
export const DEFAULT_BLOCKS: Block[] = [
  {
    id: 'phwelcome',
    name: 'Product Hunt: welcome its visitors',
    enabled: true,
    place: 'top',
    sources: ['producthunt'],
    start: '',
    end: '',
    tone: 'producthunt',
    icon: 'rocket',
    title_en: 'Welcome, Product Hunt!',
    title_ar: 'أهلًا بمجتمع Product Hunt!',
    text_en: 'Free, no sign-up: translate any video, or turn a song into a lyrics video.',
    text_ar: 'مجاني ودون تسجيل: ترجم أي فيديو، أو حوّل أغنية إلى فيديو كلمات.',
    buttons: [
      { label_en: 'Translate a video', label_ar: 'ترجم فيديو', tab: 'translate' },
      { label_en: 'Make a lyrics video', label_ar: 'اصنع فيديو كلمات', tab: 'lyrics' },
    ],
    dismissible: true,
    url: '',
  },
  {
    id: 'phlive',
    name: 'Product Hunt: live today (launch day)',
    enabled: false,
    place: 'top',
    sources: [],
    start: '',
    end: '',
    tone: 'producthunt',
    icon: 'rocket',
    title_en: '{brand} is live on Product Hunt today.',
    title_ar: '{brand} متاح على Product Hunt اليوم.',
    text_en: 'Free, no sign-up: translate any video, or turn a song into a lyrics video.',
    text_ar: 'مجاني ودون تسجيل: ترجم أي فيديو، أو حوّل أغنية إلى فيديو كلمات.',
    buttons: [{ label_en: 'Support us on Product Hunt', label_ar: 'ادعمنا على Product Hunt', url: '', primary: true }],
    dismissible: true,
    url: '',
  },
  {
    id: 'phbadge',
    name: 'Product Hunt: footer link (after launch)',
    enabled: false,
    place: 'footer',
    sources: [],
    start: '',
    end: '',
    tone: 'brand',
    icon: 'none',
    title_en: '',
    title_ar: '',
    text_en: 'Featured on Product Hunt',
    text_ar: 'ظهر على Product Hunt',
    buttons: [],
    dismissible: false,
    url: '',
  },
];

/** The saved list, or the defaults when it was never saved (or cannot be read). */
export function storedBlocks(raw: string): Block[] {
  if (!raw) return DEFAULT_BLOCKS;
  try {
    const list = JSON.parse(raw);
    const checked = checkBlocks(list);
    return 'blocks' in checked ? checked.blocks : DEFAULT_BLOCKS;
  } catch {
    return DEFAULT_BLOCKS;
  }
}

/** What visitors get: on, within its dates today, and with something to show. */
export function visibleBlocks(blocks: Block[], today = new Date().toISOString().slice(0, 10)): Block[] {
  return blocks.filter(
    (b) =>
      b.enabled &&
      (!b.start || b.start <= today) &&
      (!b.end || b.end >= today) &&
      (b.place === 'footer' ? Boolean(b.url && (b.text_en || b.text_ar)) : Boolean(b.title_en || b.title_ar || b.text_en || b.text_ar)),
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URL_OK = (u: string) => u === '' || (u.length <= 500 && (/^https:\/\/[^\s<>"]+$/i.test(u) || /^\/(?!\/)[^\s<>"]*$/.test(u)));

/** Check a list sent by the admin page: a clean copy, or what is wrong (in plain words). */
export function checkBlocks(input: unknown): { blocks: Block[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'The banners must be a list.' };
  if (input.length > MAX_BLOCKS) return { error: `At most ${MAX_BLOCKS} banners and links.` };
  const ids = new Set<string>();
  const blocks: Block[] = [];
  for (const [i, raw] of input.entries()) {
    const b = (raw ?? {}) as Record<string, unknown>;
    const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
    const which = `Banner ${i + 1}`;
    let id = /^[a-z0-9]{1,20}$/i.test(String(b.id ?? '')) ? String(b.id) : '';
    if (!id || ids.has(id)) id = `b${Date.now().toString(36)}${i}`;
    ids.add(id);
    const place = PLACES.includes(b.place as Block['place']) ? (b.place as Block['place']) : 'top';
    const tone = TONES.includes(b.tone as Block['tone']) ? (b.tone as Block['tone']) : 'brand';
    const icon = ICONS.includes(b.icon as Block['icon']) ? (b.icon as Block['icon']) : 'none';
    const start = str('start', 10);
    const end = str('end', 10);
    if ((start && !DATE.test(start)) || (end && !DATE.test(end))) return { error: `${which}: dates look like 2026-12-01.` };
    if (start && end && end < start) return { error: `${which}: the last day is before the first.` };
    const sources = (Array.isArray(b.sources) ? b.sources : String(b.sources ?? '').split(','))
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean);
    if (sources.length > 10 || sources.some((s) => !/^[a-z0-9._-]{1,40}$/.test(s))) {
      return { error: `${which}: sources are short names like producthunt or instagram-bio, separated by commas.` };
    }
    const url = str('url', 500);
    if (!URL_OK(url)) return { error: `${which}: the link must start with https:// or /.` };
    const rawButtons = Array.isArray(b.buttons) ? b.buttons.slice(0, MAX_BUTTONS) : [];
    const buttons: BlockButton[] = [];
    for (const rb of rawButtons) {
      const x = (rb ?? {}) as Record<string, unknown>;
      const label_en = String(x.label_en ?? '').trim().slice(0, 40);
      const label_ar = String(x.label_ar ?? '').trim().slice(0, 40);
      if (!label_en && !label_ar) continue;
      const tab = TABS.includes(x.tab as (typeof TABS)[number]) ? (x.tab as (typeof TABS)[number]) : undefined;
      const link = String(x.url ?? '').trim().slice(0, 500);
      if (!URL_OK(link)) return { error: `${which}: a button's address must start with https:// or /.` };
      buttons.push({ label_en, label_ar, ...(tab ? { tab } : { url: link }), ...(x.primary ? { primary: true } : {}) });
    }
    blocks.push({
      id,
      name: str('name', 60),
      enabled: b.enabled === true,
      place,
      sources,
      start,
      end,
      tone,
      icon,
      title_en: str('title_en', 120),
      title_ar: str('title_ar', 120),
      text_en: str('text_en', 400),
      text_ar: str('text_ar', 400),
      buttons: place === 'footer' ? [] : buttons,
      dismissible: b.dismissible === true,
      url,
    });
  }
  return { blocks };
}
