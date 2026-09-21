'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error';
type ToastItem = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<{
  toast: (tone: ToastTone, message: string) => void;
} | null>(null);

const AUTO_DISMISS_MS = 5000;

/**
 * Toast host. Mounted once in the root layout.
 *
 * The two live regions are rendered permanently and toasts are added into
 * them. A region that appears together with its first message is often not
 * announced at all -- screen readers watch regions that already exist. Errors
 * use `assertive` (interrupts), confirmations `polite` (waits its turn).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6">
        <div aria-live="polite" className="flex w-full flex-col items-center gap-2 md:items-end">
          {items
            .filter((item) => item.tone === 'success')
            .map((item) => (
              <ToastView key={item.id} item={item} onDismiss={dismiss} />
            ))}
        </div>
        <div aria-live="assertive" className="flex w-full flex-col items-center gap-2 md:items-end">
          {items
            .filter((item) => item.tone === 'error')
            .map((item) => (
              <ToastView key={item.id} item={item} onDismiss={dismiss} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const Icon = item.tone === 'success' ? CheckCircle2 : XCircle;
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-card border bg-surface px-4 py-3 text-sm shadow-lg',
        item.tone === 'success' ? 'border-success/50' : 'border-danger/50',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          item.tone === 'success' ? 'text-success' : 'text-danger',
        )}
      />
      <p className="flex-1 text-fg">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="text-muted hover:text-fg"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast() must be used inside <ToastProvider>.');
  }
  return context.toast;
}
