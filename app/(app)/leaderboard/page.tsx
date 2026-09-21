import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search, Trophy } from 'lucide-react';

import { StatePanel } from '@/components/shell/state-panel';
import {
  Avatar,
  Button,
  EmptyState,
  Input,
  PageHeader,
  RoleBadge,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { ROLE_LABELS } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import { PLAYER_ROLES, type PlayerRole } from '@/types/database';

export const metadata: Metadata = {
  title: 'Leaderboard',
};

const MEDAL = ['text-[#E8B53A]', 'text-[#B8C0CC]', 'text-[#C9824A]'];

/**
 * Top 100 players by overall rating, from leaderboard_v.
 *
 * The view is the ONLY place other players' primary roles are readable (0005
 * explains why a view and not a policy change). Filtering happens in the query,
 * not in memory, so "top 100 snipers" is the top 100 snipers rather than the
 * snipers among the overall top 100.
 *
 * The filter form is a plain GET form: it works without JavaScript, and every
 * filtered view has a shareable URL.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: { role?: string; region?: string; q?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const role = PLAYER_ROLES.includes(searchParams.role as PlayerRole) ? (searchParams.role as PlayerRole) : '';
  const region = (searchParams.region ?? '').slice(0, 60);
  // Escape the LIKE metacharacters so a search for "100%" matches literally.
  const q = (searchParams.q ?? '').trim().slice(0, 40);
  const pattern = q.replace(/[\\%_]/g, (c) => `\\${c}`);

  let query = supabase
    .from('leaderboard_v')
    .select('*')
    .not('overall_rating', 'is', null)
    .order('overall_rating', { ascending: false })
    .order('kd_ratio', { ascending: false })
    .limit(100);
  if (role) query = query.eq('primary_role', role);
  if (region) query = query.eq('region', region);
  if (q) query = query.ilike('bgmi_ign', `%${pattern}%`);

  const [{ data: rows, error }, { data: regionRows }, { data: me }] = await Promise.all([
    query,
    supabase.from('leaderboard_v').select('region').not('region', 'is', null).limit(1000),
    supabase.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle(),
  ]);

  if (error) return <StatePanel title="Could not load the leaderboard" body={error.message} />;

  const regions = [...new Set((regionRows ?? []).map((r) => r.region).filter(Boolean) as string[])].sort();
  const filtered = Boolean(role || region || q);

  return (
    <div>
      <PageHeader
        eyebrow="Community"
        title="Leaderboard"
        description="Top 100 players by overall rating. Ratings are computed from match history, not entered."
      />

      <form method="get" className="mb-6 grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-[1fr_12rem_12rem_auto]">
        <div className="relative">
          <label htmlFor="q" className="sr-only">
            Search by in-game name
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input id="q" name="q" defaultValue={q} placeholder="Search IGN" className="pl-9" />
        </div>
        <div>
          <label htmlFor="role" className="sr-only">
            Role
          </label>
          <Select id="role" name="role" defaultValue={role}>
            <option value="">All roles</option>
            {PLAYER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="region" className="sr-only">
            Region
          </label>
          <Select id="region" name="region" defaultValue={region}>
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Link href="/leaderboard" className="self-center text-sm text-data hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {!rows || rows.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={filtered ? 'No players match these filters' : 'No rated players yet'}
          body={filtered ? 'Try a different role, region or name.' : 'Players appear here once they have a computed rating.'}
        />
      ) : (
        <Table wrapperClassName="max-h-[70vh]">
          <THead>
            <tr>
              <TH className="w-16">Rank</TH>
              <TH>Player</TH>
              <TH>Role</TH>
              <TH>Region</TH>
              <TH className="text-right">Rating</TH>
              <TH className="text-right">K/D</TH>
              <TH className="text-right">Win rate</TH>
              <TH className="text-right">Matches</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((row, i) => (
              <TR key={row.profile_id} className={cn(row.profile_id === me?.id && 'bg-accent/5')}>
                <TD className="font-mono tabular">
                  {i < 3 ? (
                    <span className="inline-flex items-center gap-1">
                      <Trophy aria-hidden="true" className={cn('h-4 w-4', MEDAL[i])} />
                      <span className="sr-only">Rank </span>
                      {i + 1}
                    </span>
                  ) : (
                    <span className="text-muted">{i + 1}</span>
                  )}
                </TD>
                <TD>
                  <Link href={`/players/${row.profile_id}`} className="flex items-center gap-2.5 hover:text-data">
                    <Avatar name={row.display_name} size="sm" />
                    <span>
                      <span className="block font-mono text-sm text-fg">{row.bgmi_ign}</span>
                      <span className="block text-xs text-muted">{row.display_name}</span>
                    </span>
                  </Link>
                </TD>
                <TD>{row.primary_role ? <RoleBadge role={row.primary_role} size="sm" /> : <span className="text-xs text-muted">–</span>}</TD>
                <TD className="text-muted">{row.region ?? '–'}</TD>
                <TD className="text-right font-mono font-semibold tabular text-fg">{row.overall_rating}</TD>
                <TD className="text-right font-mono tabular">{row.kd_ratio !== null ? Number(row.kd_ratio).toFixed(2) : '–'}</TD>
                <TD className="text-right font-mono tabular">{row.win_rate !== null ? `${Number(row.win_rate).toFixed(1)}%` : '–'}</TD>
                <TD className="text-right font-mono tabular text-muted">{row.matches_played ?? '–'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
