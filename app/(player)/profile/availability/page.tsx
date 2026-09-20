import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { loadPlayerOverview } from '@/lib/player/queries';

import { AvailabilityEditor } from './availability-editor';

export const metadata: Metadata = {
  title: 'Availability',
};

/**
 * The weekly availability editor.
 *
 * Reads on the server, edits through the two availability actions. The rows
 * come back ordered by day then start time, so the editor does no sorting of
 * its own -- ordering in SQL keeps one definition of "in order" rather than one
 * per component.
 *
 * Only your own windows are ever here. 0003 scopes SELECT on this table to the
 * owner, and deliberately so: a weekly schedule tied to a named person is the
 * closest thing in this schema to personal-safety-relevant data, and it is
 * never needed client-side because overlap scoring runs on the server.
 */
export default async function AvailabilityPage() {
  const result = await loadPlayerOverview();

  if (result.status === 'unauthenticated') {
    redirect('/login');
  }

  if (result.status === 'no-profile') {
    return (
      <main className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">No profile row for this account</h1>
        <p>auth_user_id: {result.authUserId}</p>
        <p className="text-neutral-700">
          Check that the on_auth_user_created trigger still exists on auth.users
          (supabase/migrations/0002_triggers.sql).
        </p>
      </main>
    );
  }

  if (result.status === 'error') {
    return (
      <main className="space-y-2 text-sm">
        <h1 className="text-lg font-semibold">Could not load your availability</h1>
        <p className="text-red-800">{result.message}</p>
      </main>
    );
  }

  return (
    <main className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Availability</h1>
        <p className="mt-1 text-sm text-neutral-600">
          When you are usually free to play, as a weekly pattern. Matchmaking
          looks for players whose windows overlap yours, so a week with no
          windows cannot be matched.{' '}
          <Link href="/profile" className="underline">
            Back to profile
          </Link>
        </p>
      </div>

      <AvailabilityEditor availability={result.overview.availability} />
    </main>
  );
}
