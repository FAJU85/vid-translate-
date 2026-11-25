import { AlertTriangle, Coins } from 'lucide-react';
import type { Me, SubtitleMode } from '../../shared/api';
import { t } from '../../shared/i18n';

const MIN_BILLED = 10;
const fmt = (seconds: number) => (seconds / 60).toFixed(2);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** The worker's cost rule (accounts/credits.ts costSeconds): by the second, 10 s at least, dubbing x2. */
export const costOf = (duration: number, mode: SubtitleMode) => Math.max(MIN_BILLED, Math.ceil(duration)) * (mode === 'dub' ? 2 : 1);

/**
 * Before translating (credits on only): what this video will cost, what is left after, and the free
 * limits that apply. For a link the length is only known once it is downloaded.
 */
export function CostPreview({ me, mode, duration, isLink, onPricing }: {
  me: Me | null;
  mode: SubtitleMode;
  duration: number | null;
  isLink: boolean;
  onPricing: () => void;
}) {
  if (!me?.credits_enabled || !me.balance) return null;
  const have = me.balance.total_seconds;
  const free = me.free;
  const cost = duration ? costOf(duration, mode) : null;
  const warnings: string[] = [];
  if (free && !free.paid) {
    if (mode === 'dub' && !free.dub_preview_available) warnings.push(t("Dubbing needs credits: your free preview is used."));
    else if (mode === 'dub' && duration && duration > free.dub_preview_max_seconds)
      warnings.push(t('The free dubbing preview is for videos up to {n} seconds.', { n: free.dub_preview_max_seconds }));
    else if (free.max_video_seconds && duration && duration > free.max_video_seconds)
      warnings.push(t('Free videos can be up to {n} seconds long; this one is {time}.', { n: free.max_video_seconds, time: clock(duration) }));
  }
  if (cost !== null && cost > have) warnings.push(t('This video needs {cost} credits and you have {have}.', { cost: fmt(cost), have: fmt(have) }));
  const nextDaily = free?.next_daily_at && have < 30 ? Math.max(1, Math.ceil((free.next_daily_at * 1000 - Date.now()) / 3600000)) : null;

  return (
    <div className={`p-3 rounded-xl border text-sm ${warnings.length ? 'border-amber-500/60 bg-amber-950/30' : 'border-slate-800 bg-slate-950/60'}`}>
      <div className="flex items-start gap-2 text-slate-200">
        <Coins className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
        <div className="space-y-0.5">
          {cost !== null && duration ? (
            <p>
              {t("Video length")}{' '}<b>{clock(duration)}</b>{' '}{t("· cost")}{' '}<b>{fmt(cost)}{' '}{t("credits")}</b>
              {cost <= have && (
                <>
                  {' '}
                  {t("· left after")}{' '}<b>{fmt(have - cost)}</b>
                </>
              )}
            </p>
          ) : (
            <p>
              {t(mode === 'dub' ? 'Costs 2 credits a minute, counted by the second' : 'Costs 1 credit a minute, counted by the second')}
              {isLink ? t(' once the video is downloaded') : ''}{t(". You have")}{' '}<b>{fmt(have)}{' '}{t("credits")}</b>.
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
            </p>
          ))}
          {!warnings.length && have < 30 && (
            <p className="text-slate-400">
              {t("Low balance.")}{nextDaily ? ' ' + t('Your next free credits come in about {n} h.', { n: nextDaily }) : ''}
            </p>
          )}
          {(warnings.length > 0 || have < 30) && (
            <button type="button" onClick={onPricing} className="text-amber-300 hover:underline">
              {t("See plans and credit packs")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
