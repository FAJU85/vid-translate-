import { CircleUserRound, Coins } from 'lucide-react';
import type { Me } from '../../shared/api';
import { creditsText } from './format';
import { t } from '../../shared/i18n';

/** In the header: "Sign in", or the account's name and balance. */
export function AccountButton({ me, onOpen }: { me: Me | null; onOpen: () => void }) {
  if (!me) return null;
  const showBalance = me.credits_enabled && me.balance;
  const signInAvailable = me.sign_in.telegram || me.sign_in.google || me.sign_in.email;
  if (!me.account && !showBalance && !signInAvailable) return null;
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800 shrink-0"
    >
      {showBalance ? <Coins className="w-4 h-4 text-amber-400" /> : <CircleUserRound className="w-4 h-4" />}
      {showBalance ? (
        <span className="tabular-nums">{creditsText(me.balance!.total_seconds)}</span>
      ) : (
        <span className="hidden sm:inline">{me.account ? me.account.name?.split(' ')[0] || t("Account") : t("Sign in")}</span>
      )}
      {showBalance && !me.account && <span className="hidden sm:inline text-slate-400">{t("· Sign in")}</span>}
    </button>
  );
}
