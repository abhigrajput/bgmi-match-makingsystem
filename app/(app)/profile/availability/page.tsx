import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { StatePanel } from '@/components/shell/state-panel';
import { Card, CardBody, PageHeader } from '@/components/ui';
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
      <StatePanel
        title="No profile row for this account"
        body={`auth_user_id ${result.authUserId}. Check that the on_auth_user_created trigger still exists on auth.users (supabase/migrations/0002_triggers.sql).`}
      />
    );
  }

  if (result.status === 'error') {
    return <StatePanel title="Could not load your availability" body={result.message} />;
  }

  return (
    <div>
      <Link
        href="/profile"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to profile
      </Link>
      <PageHeader
        eyebrow="Profile"
        title="Availability"
        description="When you are usually free to play, as a weekly pattern. Squad formation scores how many hours your windows overlap with each teammate's, so a week with no windows cannot be matched."
      />
      <Card>
        <CardBody className="py-6">
          <AvailabilityEditor availability={result.overview.availability} />
        </CardBody>
      </Card>
    </div>
  );
}
