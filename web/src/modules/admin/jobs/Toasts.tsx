import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.kind === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );
  return { toasts, notify, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div aria-live="polite" className="fixed z-50 bottom-20 sm:bottom-4 right-4 left-4 sm:left-auto sm:w-96 space-y-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border shadow-xl shadow-black/40 text-sm bg-slate-900 ${
            t.kind === 'error' ? 'border-status-failed/50 text-rose-100' : 'border-slate-700 text-slate-100'
          }`}
        >
          {t.kind === 'error' ? (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-status-failed" />
          ) : (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-status-done" />
          )}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
