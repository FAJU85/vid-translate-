import { useEffect, useState } from 'react';
import { Gift, Users } from 'lucide-react';
import { referralApi, type Referral } from '../../shared/api';
import { t } from '../../shared/i18n';
import { ShareButtons } from '../../shared/share';

/**
 * "Invite friends": your own link, the usual share buttons, and how many friends it brought. The
 * reward is mentioned only when it is really given (rewards switched on, credits on).
 */
export function InviteCard() {
  const [r, setR] = useState<Referral | null>(null);
  useEffect(() => {
    referralApi.mine().then(setR, () => {});
  }, []);
  if (!r) return null;
  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="w-5 h-5 text-amber-400" /> {t('Invite friends')}
        </h2>
        {r.joined > 0 && (
          <span className="text-sm text-slate-300">
            {t('{joined} joined · {made} made a video', { joined: r.joined, made: r.made_video })}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-400">{t('Your own link: anyone new who starts from it and makes a first video counts as your friend.')}</p>
      {r.reward_minutes && (
        <p className="flex items-center gap-2 text-sm text-amber-200">
          <Gift className="w-4 h-4" /> {t('For each friend’s first video, you both get {n} free minutes.', { n: r.reward_minutes })}
        </p>
      )}
      <ShareButtons url={r.link} text={t('Translate any video, or turn a song into a lyrics video. Free:')} />
    </section>
  );
}
