import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, MessageSquareHeart, X } from 'lucide-react';
import { ApiError, feedbackApi } from '../../shared/api';
import { LANG, t } from '../../shared/i18n';

const MAX = 2000;

/**
 * "Send feedback": a link that opens a small form (a native dialog: Escape closes it and focus
 * stays inside). Anyone can send, signed in or not; the admin reads it on the /admin page.
 */
export function FeedbackButton({ className = '' }: { className?: string }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  function open() {
    setState('idle');
    setError(null);
    dialog.current?.showModal();
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setState('busy');
    setError(null);
    try {
      await feedbackApi.send(text.trim(), window.location.pathname + window.location.search, LANG);
      setText('');
      setState('sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Something went wrong. Please try again.'));
      setState('idle');
    }
  }

  return (
    <>
      <button type="button" onClick={open} className={className}>
        {t('Send feedback')}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="feedback-title"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 backdrop:bg-black/60"
      >
        <div className="p-5 space-y-3 text-start">
          <div className="flex items-center justify-between gap-3">
            <h2 id="feedback-title" className="flex items-center gap-2 font-semibold text-white">
              <MessageSquareHeart className="w-5 h-5 text-amber-400" /> {t('Send feedback')}
            </h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label={t('Close')} className="p-1 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          {state === 'sent' ? (
            <div className="py-4 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400" />
              <p className="text-sm">{t('Thank you! Your feedback was sent to the KAVOX team.')}</p>
              <button type="button" onClick={() => dialog.current?.close()} className="px-4 py-2 rounded-lg border border-slate-700 text-sm">
                {t('Close')}
              </button>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-3">
              <p className="text-sm text-slate-400">{t('What should we improve, or what went wrong? Every message is read.')}</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={MAX}
                dir="auto"
                autoFocus
                aria-label={t('Your feedback')}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-amber-400/60"
              />
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500 tabular-nums">
                  {text.length}/{MAX}
                </span>
                <button disabled={state === 'busy' || !text.trim()} className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 font-semibold text-sm text-slate-950 disabled:opacity-50">
                  {state === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Send')}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
