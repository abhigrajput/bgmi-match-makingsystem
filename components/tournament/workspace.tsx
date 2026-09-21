'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, RotateCcw, Sparkles, UserMinus, UserPlus, Users } from 'lucide-react';

import { ComparisonCharts } from '@/components/charts/comparison-charts';
import { Avatar, Badge, Button, EmptyState, RoleBadge, StatCard } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { SquadCard } from '@/components/tournament/squad-card';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/roles';
import type { FormationSummary } from '@/lib/scoring/formation';
import type { SquadView } from '@/lib/tournaments/server';
import { PLAYER_ROLES, type PlayerRole, type TournamentStatus } from '@/types/database';

import { registerForTournament, unregisterFromTournament } from '@/app/(app)/tournaments/actions';

export type PlayerRow = {
  profile_id: string;
  ign: string;
  display_name: string;
  avatar_url: string | null;
  role: PlayerRole | null;
  rating: number | null;
  region: string | null;
};

type Props = {
  slug: string;
  status: TournamentStatus;
  squadSize: number;
  isSeed: boolean;
  players: PlayerRow[];
  summary: FormationSummary | null;
  me: {
    profileId: string | null;
    registered: boolean;
    desiredRole: PlayerRole | null;
    profileComplete: boolean;
  };
};

/**
 * The interactive half of a tournament page: registration, squad formation,
 * and the three tabs. Server data arrives as props; after any mutation the
 * route is refreshed so those props are re-read under the user's own JWT,
 * rather than this component keeping a second copy of the truth in state.
 *
 * Squads are the exception: pages cannot read other players' matches (0003),
 * so they come from GET /api/tournaments/[slug]/squads, or straight from the
 * POST response right after forming.
 */
export function TournamentWorkspace({ slug, status, squadSize, isSeed, players, summary, me }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<string>('');
  const [forming, setForming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [squads, setSquads] = useState<SquadView[] | null>(null);
  const [squadError, setSquadError] = useState<string | null>(null);
  const [liveSummary, setLiveSummary] = useState<FormationSummary | null>(summary);

  useEffect(() => setLiveSummary(summary), [summary]);

  const loadSquads = useCallback(async () => {
    setSquadError(null);
    try {
      const res = await fetch(`/api/tournaments/${slug}/squads`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not load squads.');
      setSquads(body.squads as SquadView[]);
    } catch (error) {
      setSquadError(error instanceof Error ? error.message : 'Could not load squads.');
    }
  }, [slug]);

  useEffect(() => {
    if (status === 'matched' || status === 'completed') void loadSquads();
    else setSquads([]);
  }, [status, loadSquads]);

  function register() {
    startTransition(async () => {
      const result = await registerForTournament(slug, role);
      if (result.ok) {
        toast('success', "You're registered. Good luck!");
        router.refresh();
      } else toast('error', result.error);
    });
  }

  function unregister() {
    startTransition(async () => {
      const result = await unregisterFromTournament(slug);
      if (result.ok) {
        toast('success', 'You have withdrawn from this tournament.');
        router.refresh();
      } else toast('error', result.error);
    });
  }

  async function formSquads() {
    setForming(true);
    try {
      const res = await fetch(`/api/tournaments/${slug}/match`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Squad formation failed.');
      setSquads(body.squads as SquadView[]);
      setLiveSummary(body.summary as FormationSummary);
      toast('success', `Formed ${body.squads.length} squads. Open the Comparison tab to see how they beat rank-only.`);
      router.refresh();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Squad formation failed.');
    } finally {
      setForming(false);
    }
  }

  async function resetDemo() {
    setResetting(true);
    try {
      const res = await fetch(`/api/tournaments/${slug}/reset`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Reset failed.');
      setSquads([]);
      setLiveSummary(null);
      setConfirmReset(false);
      toast('success', 'Demo reset. The tournament is open for formation again.');
      router.refresh();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Reset failed.');
    } finally {
      setResetting(false);
    }
  }

  const canForm = status === 'open' && players.length >= squadSize;
  const unit = squadSize === 2 ? 'duos' : 'squads';

  // ---- registration panel ----------------------------------------------------
  const registration =
    status !== 'open' ? (
      <p className="text-sm text-muted">
        Registration is closed{me.registered ? ' — you are in this tournament.' : '.'}
      </p>
    ) : me.registered ? (
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="success">You&apos;re registered</Badge>
        {me.desiredRole ? (
          <span className="text-sm text-muted">
            as <RoleBadge role={me.desiredRole} size="sm" />
          </span>
        ) : (
          <span className="text-sm text-muted">with your usual role</span>
        )}
        <Button variant="secondary" size="sm" onClick={unregister} loading={pending}>
          <UserMinus aria-hidden="true" className="h-3.5 w-3.5" />
          Withdraw
        </Button>
      </div>
    ) : !me.profileComplete ? (
      <p className="text-sm text-muted">
        Finish your{' '}
        <Link href="/profile" className="font-medium text-data hover:underline">
          preferences
        </Link>{' '}
        and{' '}
        <Link href="/profile/availability" className="font-medium text-data hover:underline">
          availability
        </Link>{' '}
        to register.
      </p>
    ) : (
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <Label htmlFor="desired_role">Role for this tournament</Label>
          <Select id="desired_role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">My usual role</option>
            {PLAYER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={register} loading={pending}>
          <UserPlus aria-hidden="true" className="h-4 w-4" />
          Register
        </Button>
      </div>
    );

  // ---- tabs --------------------------------------------------------------------
  const playersTab =
    players.length === 0 ? (
      <EmptyState icon={Users} title="No one has registered yet" body="Be the first: register above." />
    ) : (
      <Table wrapperClassName="max-h-[60vh]">
        <THead>
          <tr>
            <TH>Player</TH>
            <TH>Role</TH>
            <TH className="text-right">Rating</TH>
            <TH>Region</TH>
          </tr>
        </THead>
        <TBody>
          {players.map((p) => (
            <TR key={p.profile_id}>
              <TD>
                <Link href={`/players/${p.profile_id}`} className="flex items-center gap-2.5 hover:text-data">
                  <Avatar name={p.display_name} src={p.avatar_url} size="sm" />
                  <span>
                    <span className="block font-mono text-sm text-fg">{p.ign}</span>
                    <span className="block text-xs text-muted">{p.display_name}</span>
                  </span>
                  {p.profile_id === me.profileId ? <Badge tone="accent">you</Badge> : null}
                </Link>
              </TD>
              <TD>{p.role ? <RoleBadge role={p.role} size="sm" /> : <span className="text-xs text-muted">Not set</span>}</TD>
              <TD className="text-right font-mono tabular">{p.rating ?? '–'}</TD>
              <TD className="text-muted">{p.region ?? '–'}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    );

  const squadsTab =
    squadError ? (
      <div role="alert" className="rounded-card border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
        {squadError}{' '}
        <button type="button" onClick={() => void loadSquads()} className="font-medium underline">
          Try again
        </button>
      </div>
    ) : squads === null ? (
      <p role="status" className="text-sm text-muted">Loading squads…</p>
    ) : squads.length === 0 ? (
      <EmptyState
        icon={Sparkles}
        title={`No ${unit} formed yet`}
        body={
          canForm
            ? `${players.length} players are registered. Form ${unit} to see who plays with whom, and why.`
            : `At least ${squadSize} registered players are needed before ${unit} can be formed.`
        }
        action={
          canForm ? (
            <Button onClick={formSquads} loading={forming}>
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              Form {unit}
            </Button>
          ) : undefined
        }
      />
    ) : (
      <div className="space-y-6">
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {squads.map((squad, i) => (
            <li key={squad.match_id} className="flex">
              <div className="w-full">
                <SquadCard squad={squad} index={i} />
              </div>
            </li>
          ))}
        </ul>
        {liveSummary && liveSummary.unmatched.length > 0 ? (
          <section aria-labelledby="unmatched-heading">
            <h3 id="unmatched-heading" className="mb-3 text-sm font-semibold text-fg">
              Not placed ({liveSummary.unmatched.length})
            </h3>
            <ul className="divide-y divide-border rounded-card border border-border bg-surface">
              {liveSummary.unmatched.map((u) => (
                <li key={u.profile_id} className="px-4 py-3 text-sm">
                  <span className="font-mono text-fg">{u.ign}</span>
                  <span className="mt-0.5 block text-muted">{u.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );

  const comparisonTab = liveSummary ? (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Squad score"
          value={(liveSummary.comparison.optimizer.meanSquadScore * 100).toFixed(1)}
          hint={`Rank-only: ${(liveSummary.comparison.baseline.meanSquadScore * 100).toFixed(1)}`}
        />
        <StatCard
          label="Vetoed pairs"
          value={liveSummary.comparison.optimizer.vetoedPairs}
          hint={`Rank-only: ${liveSummary.comparison.baseline.vetoedPairs}`}
        />
        <StatCard
          label="Role coverage"
          value={`${(liveSummary.comparison.optimizer.roleCoverage * 100).toFixed(0)}%`}
          hint={`Rank-only: ${(liveSummary.comparison.baseline.roleCoverage * 100).toFixed(0)}%`}
        />
        <StatCard
          label="Rating spread"
          value={liveSummary.comparison.optimizer.meanRatingSpread.toFixed(1)}
          hint={`Rank-only: ${liveSummary.comparison.baseline.meanRatingSpread.toFixed(1)}`}
        />
      </div>
      <ComparisonCharts comparison={liveSummary.comparison} />
      <p className="text-xs text-muted">
        Both groupings are measured on the same {liveSummary.players} registered players with the same
        scorer ({liveSummary.scoring_source === 'ml' ? `ML model ${liveSummary.model_version}` : 'rule-based'}).
        Rank-only sorts by rating and cuts consecutive groups, so it seats vetoed pairs together and
        places everyone; the optimizer refuses vetoed pairs, which is why it can leave players unplaced.
        Rank-only wins on rating spread by construction.
      </p>
    </div>
  ) : (
    <EmptyState
      icon={BarChart3}
      title="Nothing to compare yet"
      body={`Form ${unit} first. The optimizer and a rank-only baseline then run on the same players, side by side.`}
    />
  );

  return (
    <div className="space-y-6">
      <section aria-label="Registration" className="rounded-card border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">{registration}</div>
          <div className="flex flex-wrap gap-2">
            {canForm ? (
              <Button onClick={formSquads} loading={forming}>
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                Form {unit}
              </Button>
            ) : null}
            {isSeed && status === 'matched' ? (
              <Button variant="danger" onClick={() => setConfirmReset(true)}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Reset demo
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <Tabs
        label="Tournament sections"
        defaultTab={status === 'open' ? 'players' : 'squads'}
        items={[
          { id: 'players', label: `Players (${players.length})`, content: playersTab },
          { id: 'squads', label: squads && squads.length > 0 ? `Squads (${squads.length})` : 'Squads', content: squadsTab },
          { id: 'comparison', label: 'Comparison', content: comparisonTab },
        ]}
      />

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset this demo tournament?"
        description="All formed squads, including any feedback given in them, are deleted and the tournament reopens. Registrations are kept."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={resetDemo} loading={resetting}>
            Reset demo
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
