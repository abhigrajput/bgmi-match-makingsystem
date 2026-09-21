import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'data'
  | 'success'
  | 'danger'
  | 'warning';

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-2 text-muted',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  data: 'border-data/40 bg-data/10 text-data',
  success: 'border-success/40 bg-success/10 text-success',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-warning',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
