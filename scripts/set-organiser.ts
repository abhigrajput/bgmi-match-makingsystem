/**
 * scripts/set-organiser.ts -- grant or revoke the organiser role (0006).
 *
 *   npx tsx scripts/set-organiser.ts --target prod --email someone@example.com
 *   npx tsx scripts/set-organiser.ts --target prod --email someone@example.com --revoke
 *
 * The only way the role is granted: clients cannot write profiles.is_organiser
 * (0006), so this runs with the service role from a trusted machine. Looks the
 * account up by email through the Auth admin API and flips the flag on its
 * profile row. Prints the account's in-game name, never any credential.
 */

import { parseTarget, serviceClient } from './lib/env';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const target = parseTarget();
  const email = arg('--email')?.trim().toLowerCase();
  const revoke = process.argv.includes('--revoke');
  if (!email) throw new Error('Pass --email <account email>.');

  const db = serviceClient(target);

  // listUsers pages at 50 by default; walk pages until the email turns up.
  let userId: string | null = null;
  for (let page = 1; page <= 50 && !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Listing users failed: ${error.message}`);
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) throw new Error(`No account with that email on ${target}.`);

  const { data, error } = await db
    .from('profiles')
    .update({ is_organiser: !revoke })
    .eq('auth_user_id', userId)
    .select('bgmi_ign, is_organiser')
    .single();
  if (error || !data) throw new Error(`Updating the profile failed: ${error?.message ?? 'no profile row'}`);

  console.log(`${data.bgmi_ign} on ${target}: is_organiser = ${data.is_organiser}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
