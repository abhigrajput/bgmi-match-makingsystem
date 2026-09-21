import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * API route handlers with every I/O boundary mocked: the caller's identity
 * (lib/api/auth), the service-role client (lib/supabase/admin), the user's
 * cookie client (lib/supabase/server) and the tournament data layer. What is
 * under test is each route's decision logic -- who gets a 401/403/404/409,
 * that the atomic claim is honoured, and that a failed formation rolls back.
 */

const state = vi.hoisted(() => ({
  caller: { userId: 'u1', profileId: 'p1' } as unknown,
  tournament: null as null | Record<string, unknown>,
  players: [] as unknown[],
  claimRows: [{ id: 't1' }] as unknown[] | null,
  persistThrows: false,
  updates: [] as Record<string, unknown>[],
  deletes: [] as string[],
  visibleMatch: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/api/auth', async () => {
  const { NextResponse: NR } = await import('next/server');
  return {
    authenticate: vi.fn(async () => state.caller),
    isResponse: (v: unknown) => v instanceof NR,
    jsonError: (message: string, status: number) => NR.json({ error: message }, { status }),
  };
});

function chain(result: () => unknown) {
  // A minimal PostgREST-style builder: every filter returns itself, and
  // awaiting it (or calling select/maybeSingle) yields `result()`.
  const builder: Record<string, unknown> = {};
  for (const m of ['eq', 'neq', 'in', 'order', 'limit']) builder[m] = () => builder;
  builder.select = () => Promise.resolve(result());
  builder.maybeSingle = () => Promise.resolve(result());
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        state.updates.push({ table, ...values });
        return chain(() => ({ data: state.claimRows, error: null }));
      },
      delete: () => {
        state.deletes.push(table);
        return chain(() => ({ error: null }));
      },
    }),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({
      select: () => chain(() => ({ data: state.visibleMatch, error: null })),
    }),
  }),
}));

vi.mock('@/lib/tournaments/server', () => ({
  getTournamentBySlug: vi.fn(async () => state.tournament),
  loadRegistrantVectors: vi.fn(async () => state.players),
  persistFormation: vi.fn(async () => {
    if (state.persistThrows) throw new Error('insert failed');
    return ['m1'];
  }),
  loadSquads: vi.fn(async () => [{ match_id: 'm1', members: [] }]),
}));

vi.mock('@/lib/scoring/formation', () => ({
  runFormation: vi.fn(() => ({
    squads: [],
    summary: { unmatched: [], comparison: { optimizer: {}, baseline: {} } },
  })),
}));

import { POST as completeMatch } from '../matches/[id]/complete/route';
import { POST as formSquads } from '../tournaments/[slug]/match/route';
import { POST as resetDemo } from '../tournaments/[slug]/reset/route';
import { GET as getSquads } from '../tournaments/[slug]/squads/route';

const req = new Request('http://localhost/api');
const slug = { params: { slug: 'hubballi-weekend-cup' } };

beforeEach(() => {
  state.caller = { userId: 'u1', profileId: 'p1' };
  state.tournament = { id: 't1', status: 'open', squad_size: 4, is_seed: true, formation_summary: null };
  state.players = Array.from({ length: 8 }, (_, i) => ({ profileId: `p${i}` }));
  state.claimRows = [{ id: 't1' }];
  state.persistThrows = false;
  state.updates = [];
  state.deletes = [];
  state.visibleMatch = { id: 'm1', status: 'ready', started_at: null };
});

describe('POST /api/tournaments/[slug]/match', () => {
  it('rejects signed-out callers with 401', async () => {
    state.caller = NextResponse.json({ error: 'Sign in' }, { status: 401 });
    expect((await formSquads(req, slug)).status).toBe(401);
  });

  it('404s an unknown tournament', async () => {
    state.tournament = null;
    expect((await formSquads(req, slug)).status).toBe(404);
  });

  it('409s a tournament that is not open', async () => {
    state.tournament = { ...state.tournament!, status: 'matched' };
    expect((await formSquads(req, slug)).status).toBe(409);
  });

  it('409s when fewer players than one squad are registered', async () => {
    state.players = state.players.slice(0, 3);
    const res = await formSquads(req, slug);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/at least 4/);
  });

  it('409s when another request already claimed the tournament', async () => {
    state.claimRows = [];
    expect((await formSquads(req, slug)).status).toBe(409);
  });

  it('forms squads and returns them', async () => {
    const res = await formSquads(req, slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.squads).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ table: 'tournaments', status: 'matched' });
  });

  it('re-opens the tournament when persisting fails', async () => {
    state.persistThrows = true;
    const res = await formSquads(req, slug);
    expect(res.status).toBe(500);
    expect(state.updates.at(-1)).toMatchObject({ table: 'tournaments', status: 'open' });
  });
});

describe('GET /api/tournaments/[slug]/squads', () => {
  it('requires a signed-in caller', async () => {
    state.caller = NextResponse.json({ error: 'Sign in' }, { status: 401 });
    expect((await getSquads(req, slug)).status).toBe(401);
  });

  it('returns squads for a known tournament', async () => {
    const res = await getSquads(req, slug);
    expect(res.status).toBe(200);
    expect((await res.json()).squads).toHaveLength(1);
  });
});

describe('POST /api/tournaments/[slug]/reset', () => {
  it('refuses non-demo tournaments with 403 and deletes nothing', async () => {
    state.tournament = { ...state.tournament!, is_seed: false };
    expect((await resetDemo(req, slug)).status).toBe(403);
    expect(state.deletes).toHaveLength(0);
  });

  it('deletes the squads and re-opens a demo tournament', async () => {
    expect((await resetDemo(req, slug)).status).toBe(200);
    expect(state.deletes).toContain('matches');
    expect(state.updates.at(-1)).toMatchObject({ status: 'open', formation_summary: null });
  });
});

describe('POST /api/matches/[id]/complete', () => {
  const match = { params: { id: 'm1' } };

  it('404s a match the caller cannot see (not a participant)', async () => {
    state.visibleMatch = null;
    expect((await completeMatch(req, match)).status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses to complete an abandoned match', async () => {
    state.visibleMatch = { id: 'm1', status: 'abandoned', started_at: null };
    expect((await completeMatch(req, match)).status).toBe(409);
  });

  it('is idempotent for an already completed match', async () => {
    state.visibleMatch = { id: 'm1', status: 'completed', started_at: '2026-01-01T00:00:00Z' };
    const res = await completeMatch(req, match);
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(0);
  });

  it('stamps started_at and ended_at when completing', async () => {
    const res = await completeMatch(req, match);
    expect(res.status).toBe(200);
    const update = state.updates[0]!;
    expect(update.status).toBe('completed');
    expect(update.started_at).toBeTruthy();
    expect(update.ended_at).toBeTruthy();
  });
});
