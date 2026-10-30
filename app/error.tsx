'use client';

import { RouteError } from '@/components/shell/route-states';

/** Anything outside the signed-in routes, which have their own error.tsx. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center bg-bg px-4 py-12">
      <RouteError error={error} reset={reset} />
    </main>
  );
}
