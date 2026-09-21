import { Badge, type BadgeTone } from './badge';

/**
 * Status chip for both lifecycles in the schema -- match_status and
 * tournament_status. Kept as one component with one map so "completed" reads
 * the same whichever table it came from.
 */
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  // tournament_status
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'success' },
  matched: { label: 'Squads formed', tone: 'data' },
  // match_status
  forming: { label: 'Forming', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'accent' },
  in_progress: { label: 'In progress', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  abandoned: { label: 'Abandoned', tone: 'danger' },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
