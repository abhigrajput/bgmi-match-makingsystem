'use client';

import { RouteError } from '@/components/shell/route-states';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} title="Could not load the leaderboard" />;
}
