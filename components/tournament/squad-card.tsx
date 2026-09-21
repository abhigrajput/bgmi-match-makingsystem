import Link from 'next/link';
import { AlertTriangle, Brain, ChevronDown, Crown, Ruler } from 'lucide-react';

import { Avatar, Badge, RoleBadge, ScoreRing } from '@/components/ui';
import type { SquadView } from '@/lib/tournaments/server';

/**
 * One formed squad.
 *
 * "Why this squad" is a native <details>: keyboard-operable and announced as
 * expandable with no JavaScript, and it keeps working inside a server-rendered
 * list. The weakest pair is pulled out of the reasons into its own callout,
 * because it is the one line an organiser should read before the match.
 */
export function SquadCard({ squad, index }: { squad: SquadView; index: number }) {
  const weakest = squad.reasons.find((r) => r.startsWith('Weakest link'));
  const others = squad.reasons.filter((r) => r !== weakest);

  return (
    <article className="flex flex-col rounded-card border border-border bg-surface transition-colors duration-150 hover:border-border-strong">
      <header className="flex items-center gap-4 border-b border-border p-4">
        <ScoreRing score={squad.synergy_score ?? 0} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">
            <Link href={`/matches/${squad.match_id}`} className="hover:text-accent">
              Squad {index + 1}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {squad.scoring_source === 'ml' ? (
              <Badge tone="data">
                <Brain aria-hidden="true" className="h-3 w-3" />
                ML scored
              </Badge>
            ) : (
              <Badge tone="neutral">
                <Ruler aria-hidden="true" className="h-3 w-3" />
                Rule-based
              </Badge>
            )}
          </div>
        </div>
      </header>

      <ul className="divide-y divide-border">
        {squad.members.map((member) => (
          <li key={member.profile_id} className="flex items-center gap-3 px-4 py-2.5">
            <Avatar name={member.display_name} src={member.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-mono text-sm text-fg">
                {member.ign}
                {member.is_leader ? (
                  <Crown aria-label="Squad leader" className="h-3.5 w-3.5 shrink-0 text-accent" />
                ) : null}
              </p>
              <p className="truncate text-xs text-muted">{member.display_name}</p>
            </div>
            {member.role ? <RoleBadge role={member.role} size="sm" /> : null}
            <span className="w-8 text-right font-mono text-sm tabular text-muted">
              {member.rating ?? '–'}
            </span>
          </li>
        ))}
      </ul>

      {weakest ? (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-input border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>{weakest}</span>
        </p>
      ) : null}

      <details className="group mt-auto px-4 pb-4 pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-data hover:underline">
          <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform duration-150 group-open:rotate-180" />
          Why this squad
        </summary>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {others.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden="true" className="text-accent">
                ›
              </span>
              {reason}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
