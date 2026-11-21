import { Check, Gift, Sparkles } from 'lucide-react';
import type { AppConfig, Me } from '../../shared/api';
import { PACKS, PLANS, perCredit } from './plans';

const credits = (seconds: number) => +(seconds / 60).toFixed(2);

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group p-4 rounded-xl border border-slate-800 bg-slate-900">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-medium text-white">
        {q}
        <span className="text-slate-500 group-open:rotate-45 transition-transform">+</span>
      </summary>
      <div className="mt-2 text-sm text-slate-300 leading-relaxed">{children}</div>
    </details>
  );
}

/** Prices, the free credits, how credits are counted, and the limits. */
export function PricingView({ me, config, onSignIn }: { me: Me | null; config: AppConfig | null; onSignIn: () => void }) {
  const a = me?.allowances ?? { guest_trial: 30, signup_bonus: 180, daily: 30, daily_period: 86400 };
  const signedIn = Boolean(me?.account);
  const maxMb = config?.max_upload_mb ?? 500;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Pricing</h1>
        <p className="mt-2 text-slate-300 max-w-2xl">
          1 credit = 1 minute of video, counted by the second. Subtitles cost 1 credit a minute; dubbing (a translated voice)
          costs 2. Re-rendering your edited subtitles is free.
        </p>
      </section>

      <section className="p-5 rounded-2xl border border-emerald-800/60 bg-emerald-950/30">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <Gift className="w-5 h-5 text-emerald-400" /> Free to start
        </h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-200 sm:grid-cols-3">
          <li>
            <b>{credits(a.guest_trial)} credit</b> to try it, no account needed
          </li>
          <li>
            <b>{credits(a.signup_bonus)} credits</b> when you sign in the first time
          </li>
          <li>
            <b>{credits(a.daily)} credit every day</b> after that (refills 24 h after the last)
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Free videos can be up to 90 seconds long; dubbing needs credits, with one free preview of up to 15 seconds. Daily
          credits do not add up: unused ones are replaced by the next day’s.
        </p>
        {!signedIn && me?.sign_in && (me.sign_in.telegram || me.sign_in.google || me.sign_in.email) && (
          <button onClick={onSignIn} className="mt-4 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-sm font-semibold text-slate-950">
            Sign in for {credits(a.signup_bonus)} free credits
          </button>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Monthly plans</h2>
        <p className="text-sm text-slate-400">For people who translate every week. Credits renew each month.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className={`relative p-5 rounded-2xl border bg-slate-900 ${p.best ? 'border-amber-400 shadow-lg shadow-amber-500/10' : 'border-slate-800'}`}
            >
              {p.best && (
                <span className="absolute -top-3 left-5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-xs font-bold text-slate-950">
                  <Sparkles className="w-3 h-3" /> Best value
                </span>
              )}
              <div className="text-sm text-slate-400">{p.name}</div>
              <div className="mt-1 text-3xl font-bold text-white">
                ${p.price}
                <span className="text-sm font-normal text-slate-400"> / month</span>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-200">
                <li className="flex gap-2">
                  <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {p.credits} credits ({p.credits} min of video)
                </li>
                <li className="flex gap-2">
                  <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {perCredit(p.price, p.credits)} per minute
                </li>
                <li className="flex gap-2">
                  <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Videos of any length, dubbing included
                </li>
              </ul>
              <button disabled className="mt-5 w-full py-2 rounded-lg border border-slate-700 text-sm text-slate-400 cursor-not-allowed">
                Payments open soon
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white">Credit packs</h2>
        <p className="text-sm text-slate-400">Pay once, use whenever: bought credits never expire.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {PACKS.map((p) => (
            <div key={p.id} className="p-5 rounded-2xl border border-slate-800 bg-slate-900 flex items-center justify-between gap-4">
              <div>
                <div className="text-xl font-bold text-white">{p.credits} credits</div>
                <div className="text-sm text-slate-400">
                  ${p.price} · {perCredit(p.price, p.credits)} per minute
                </div>
              </div>
              <button disabled className="px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-400 cursor-not-allowed">
                Soon
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Questions and limits</h2>
        <Faq q="How is a video counted?">
          By its length, to the second: a 75-second video costs 1.25 credits. Every video counts as at least 10 seconds. You see
          the cost before you start; for a link, the length is known once the video is downloaded.
        </Faq>
        <Faq q="What if a translation fails?">
          You get the credits back automatically, including when you cancel. If a video turns out longer than your credits
          cover, it is stopped before the work starts and nothing is charged.
        </Faq>
        <Faq q="Which credits are used first?">
          The ones that expire first: today’s free credits, then a monthly plan, then bonus credits, and bought credits last.
        </Faq>
        <Faq q="Which videos can I translate?">
          Files up to {maxMb} MB on the website and 20 MB in the Telegram bot, and public links from Facebook, Instagram, TikTok and
          many other sites. YouTube links are not supported (YouTube blocks our server): upload the file instead.
        </Faq>
        <Faq q="How long are my files kept?">
          24 hours. Download what you need: the video, subtitles in every format, both languages, and the transcript.
        </Faq>
        <Faq q="Do I need an account?">
          No: you can try it right away. Signing in (with Telegram, Google or an email link) gives you {credits(a.signup_bonus)}{' '}
          free credits, a free credit every day, and one balance for the website and the Telegram bot.
        </Faq>
      </section>
    </div>
  );
}
