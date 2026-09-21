/**
 * The small presentational pieces: Skeleton, EmptyState, ProgressBar,
 * ScoreRing, Avatar, StatCard, PageHeader.
 *
 * Grouped in one module because none has state or more than a few lines of
 * markup, and all are server-renderable. Each is still exported by name and
 * re-exported from ./index, so call sites import them like any other.
 */

import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/** A placeholder block. aria-hidden: the loading.tsx wrapper announces once. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-input bg-surface-2', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

/**
 * Every empty list says why it is empty and what to do next. A blank table
 * reads as "broken" far more often than as "nothing yet".
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <div className="rounded-full border border-border bg-surface-2 p-3">
        <Icon aria-hidden="true" className="h-6 w-6 text-muted" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = 'accent',
  className,
}: {
  value: number;
  max?: number;
  /** Accessible name. Required: a bare progressbar announces only a number. */
  label: string;
  tone?: 'accent' | 'data' | 'success';
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill =
    tone === 'data' ? 'bg-data' : tone === 'success' ? 'bg-success' : 'bg-accent';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreRing
// ---------------------------------------------------------------------------

/**
 * Colour band for a 0-100 score. The cut points are presentation, not model
 * output: they only decide which colour a number is drawn in.
 */
export function scoreBand(score: number): 'success' | 'accent' | 'danger' {
  if (score >= 70) return 'success';
  if (score >= 45) return 'accent';
  return 'danger';
}

const BAND_STROKE = {
  success: 'stroke-success',
  accent: 'stroke-accent',
  danger: 'stroke-danger',
} as const;

export function ScoreRing({
  score,
  size = 64,
  label = 'Synergy score',
}: {
  /** 0-100. */
  score: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const band = scoreBand(clamped);

  return (
    <div
      role="img"
      aria-label={`${label}: ${Math.round(clamped)} out of 100`}
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-2"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className={cn('transition-[stroke-dashoffset] duration-500', BAND_STROKE[band])}
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute font-mono text-sm font-semibold tabular text-fg"
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  const letters = parts.length >= 2
    ? `${parts[0]![0]}${parts[1]![0]}`
    : name.trim().slice(0, 2);
  return letters.toUpperCase() || '?';
}

/**
 * Initials fallback always, image when a URL exists. A plain <img>, not
 * next/image: avatar_url is arbitrary user input and next/image would need
 * every possible host allow-listed or it throws at render. Empty alt, because
 * the name is always printed beside it.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims =
    size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-16 w-16 text-lg' : 'h-9 w-9 text-xs';
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn('shrink-0 rounded-full border border-border object-cover', dims, className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-mono font-semibold text-muted',
        dims,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Signed change, rendered with an arrow. Omit when there is no baseline. */
  delta?: { value: string; positive: boolean };
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('rounded-card border border-border bg-surface p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {Icon ? <Icon aria-hidden="true" className="h-4 w-4 text-muted" /> : null}
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular text-fg">{value}</p>
      {delta ? (
        <p
          className={cn(
            'mt-1 inline-flex items-center gap-0.5 text-xs font-medium',
            delta.positive ? 'text-success' : 'text-danger',
          )}
        >
          {delta.positive ? (
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {delta.value}
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
