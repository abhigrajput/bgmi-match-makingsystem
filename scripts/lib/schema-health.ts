/**
 * Expected catalog state, checked against public.schema_health() (0008).
 * Shared by scripts/verify-prod.ts and scripts/auth-health.ts.
 */

export const EXPECTED_PUBLIC_TABLES = 13;
export const EXPECTED_POLICY_COUNT = 25;

export type SchemaHealth = {
  handle_new_user: { exists: boolean; security_definer: boolean; search_path_pinned: boolean } | null;
  on_auth_user_created: { exists: boolean; enabled: boolean } | null;
  public_tables: number;
  tables_without_rls: string[];
  policy_count: number;
  definer_functions_without_search_path: string[];
};

export type HealthCheck = { name: string; ok: boolean; detail: string };

export function evaluateSchemaHealth(h: SchemaHealth): HealthCheck[] {
  const fn = h.handle_new_user;
  const trigger = h.on_auth_user_created;
  return [
    { name: 'handle_new_user() exists', ok: !!fn?.exists, detail: '' },
    { name: 'handle_new_user() is SECURITY DEFINER', ok: !!fn?.security_definer, detail: '' },
    { name: 'handle_new_user() has search_path pinned', ok: !!fn?.search_path_pinned, detail: '' },
    {
      name: 'on_auth_user_created trigger on auth.users',
      ok: !!trigger?.exists && trigger.enabled,
      detail: trigger ? (trigger.enabled ? 'enabled' : 'DISABLED') : 'missing',
    },
    {
      name: `${EXPECTED_PUBLIC_TABLES} public tables, all with RLS`,
      ok: h.public_tables === EXPECTED_PUBLIC_TABLES && h.tables_without_rls.length === 0,
      detail: `${h.public_tables} tables${h.tables_without_rls.length ? `, no RLS: ${h.tables_without_rls.join(', ')}` : ''}`,
    },
    {
      name: `${EXPECTED_POLICY_COUNT} RLS policies on public tables`,
      ok: h.policy_count === EXPECTED_POLICY_COUNT,
      detail: `${h.policy_count} found`,
    },
    {
      name: 'every SECURITY DEFINER function pins search_path',
      ok: h.definer_functions_without_search_path.length === 0,
      detail: h.definer_functions_without_search_path.join(', '),
    },
  ];
}
