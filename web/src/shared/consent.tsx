import { useState } from 'react';
import { consentApi } from './api';
import { t } from './i18n';

/**
 * PDPL consent: before the first video and before signing in, the person ticks a box (never
 * ticked for them) to agree to the Terms of Use and the Privacy Policy. The agreed version is
 * kept in this browser and sent to the server, which keeps it with the account. When the
 * documents change (a new version), the box shows again.
 */
const KEY = 'kavox_consent';

export function storedConsent(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function keepConsent(version: string): void {
  try {
    localStorage.setItem(KEY, version);
  } catch {
    /* storage blocked: the server still keeps it with the account */
  }
}

/** Tell the server (the account this browser is, or is signed in to) that the person agreed. */
export function sendConsent(version: string): Promise<unknown> {
  return consentApi.give(version).catch(() => null);
}

/** Whether this browser already agreed to `version`, and a setter that also keeps it. */
export function useConsent(version: string | undefined): [boolean, (on: boolean) => void] {
  const [agreed, setAgreed] = useState(() => Boolean(version) && storedConsent() === version);
  const set = (on: boolean) => {
    setAgreed(on);
    if (on && version) {
      keepConsent(version);
      void sendConsent(version);
    }
  };
  return [agreed || (Boolean(version) && storedConsent() === version), set];
}

/** The box: unticked by default, with links to both documents (they open in a new tab). */
export function ConsentCheck({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-slate-300 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        className="mt-0.5 w-4 h-4 shrink-0 accent-amber-400"
      />
      <span>
        {t('I agree to the')}{' '}
        <a href="/terms" target="_blank" rel="noreferrer" className="text-amber-300 underline underline-offset-2">
          {t('Terms of Use')}
        </a>{' '}
        {t('and the')}{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="text-amber-300 underline underline-offset-2">
          {t('Privacy Policy')}
        </a>
        {t(', including the processing of my videos by services outside Saudi Arabia.')}
      </span>
    </label>
  );
}
