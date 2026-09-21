'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';

/**
 * Shared bodies for every route's loading.tsx and error.tsx.
 *
 * The skeletons mirror the real layouts' proportions -- header, then the grid
 * or table the page renders -- so content arriving does not shove the page
 * around. Each wrapper carries role="status" and one sr-only sentence; the
 * individual blocks are aria-hidden, since "loading" read out forty times is
 * noise.
 */

function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <Skeleton className="mb-6 h-28 w-full" />
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </Loading>
  );
}

export function TableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <Loading>
      <HeaderSkeleton />
      <Skeleton className="mb-4 h-10 w-full max-w-lg" />
      <div className="overflow-hidden rounded-card border border-border">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border px-4 py-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <Loading>
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </Loading>
  );
}

export function DetailSkeleton() {
  return (
    <Loading>
      <Skeleton className="mb-4 h-4 w-28" />
      <Skeleton className="mb-6 h-36 w-full" />
      <Skeleton className="mb-4 h-10 w-full max-w-md" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </Loading>
  );
}

export function FormSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <Skeleton className="mb-6 h-28 w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </Loading>
  );
}

/**
 * Body for every error.tsx. `reset` re-renders the segment, which re-runs its
 * server queries -- the right retry for a transient network or database
 * failure. The digest is shown because it is the only handle that links what
 * the user saw to the server log line.
 */
export function RouteError({
  error,
  reset,
  title = 'Something went wrong loading this page',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="rounded-card border border-danger/40 bg-danger/5 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <h1 className="text-base font-semibold text-fg">{title}</h1>
          <p className="mt-1 text-sm text-muted">
            This is usually temporary. Try again, and if it keeps happening,
            reload the page.
          </p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-muted">Reference: {error.digest}</p>
          ) : null}
          <Button variant="secondary" size="sm" className="mt-4" onClick={reset}>
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
