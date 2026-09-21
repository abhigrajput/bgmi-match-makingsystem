import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * Inline form outcome. `role` is chosen by tone: errors are alerts (announced
 * immediately), confirmations are status (announced politely).
 */
export function Banner({
  tone,
  children,
  className,
}: {
  tone: 'error' | 'success' | 'info';
  children: React.ReactNode;
  className?: string;
}) {
  const Icon =
    tone === 'error' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-input border px-3 py-2.5 text-sm',
        tone === 'error' && 'border-danger/40 bg-danger/10 text-danger',
        tone === 'success' && 'border-success/40 bg-success/10 text-success',
        tone === 'info' && 'border-warning/40 bg-warning/10 text-warning',
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
