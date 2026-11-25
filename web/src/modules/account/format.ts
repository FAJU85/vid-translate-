import type { Bucket } from '../../shared/api';
import { t } from '../../shared/i18n';

const SECONDS_PER_CREDIT = 60;

/** 870 seconds → "14.50". */
export const creditsText = (seconds: number) => (seconds / SECONDS_PER_CREDIT).toFixed(2);

/** 870 seconds → "14 min 30 s". */
export function timeText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min${s ? ` ${s} s` : ''}` : `${s} s`;
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  daily: t("Free today"),
  monthly: t("This month’s plan"),
  bonus: t("Bonus"),
  topup: t("Bought credits"),
};
