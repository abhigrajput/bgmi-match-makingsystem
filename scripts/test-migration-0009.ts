/**
 * scripts/test-migration-0009.ts -- behaviour of 0009, as the roles that matter.
 *
 *   npx tsx scripts/test-migration-0009.ts --target local
 *   npx tsx scripts/test-migration-0009.ts --target prod
 *
 * Anon may insert a contact message and read nothing. A normal signed-in player
 * may insert and read nothing. An organiser may read. Nobody may update or
 * delete, or touch rate_limits directly. rate_limit_hit() counts within its
 * window. Every row and account it creates is removed. Prints PASS/FAIL only.
 */

import { createClient } from '@supabase/supabase-js';

import { anonCredentialsFor, parseTarget, serviceClient } from './lib/env';

async function main() {
  const target = parseTarget();
  const db = serviceClient(target);
  const { url, anonKey } = anonCredentialsFor(target);
  if (!anonKey) throw new Error('No anon key for this target.');

  let failures = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  };

  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const anon = createClient(url, anonKey, noSession);
  const runId = Date.now().toString(36);
  const marker = `migration-test-${runId}@squadsync-e2e.test`;
  const row = { name: 'Migration test', email: marker, message: 'Migration test message, safe to delete.' };

  const insert = await anon.from('contact_messages').insert(row);
  check('anon can insert', !insert.error, insert.error?.code ?? '');

  const anonRead = await anon.from('contact_messages').select('id');
  check('anon cannot read', !!anonRead.error, anonRead.error?.code ?? `${anonRead.data?.length} rows`);

  const short = await anon.from('contact_messages').insert({ ...row, message: 'short' });
  check('too-short message refused by the check constraint', short.error?.code === '23514', short.error?.code ?? 'accepted');

  const forged = await anon.from('contact_messages').insert({ ...row, created_at: '2000-01-01T00:00:00Z' });
  check('anon cannot set created_at', !!forged.error, forged.error?.code ?? 'accepted');

  const rateTable = await anon.from('rate_limits').select('key');
  check('anon cannot read rate_limits', !!rateTable.error, rateTable.error?.code ?? `${rateTable.data?.length} rows`);

  const key = `test-${runId}`;
  const hits: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const { data, error } = await anon.rpc('rate_limit_hit', { p_key: key, p_max: 2, p_window_seconds: 60 });
    if (error) check('rate_limit_hit callable', false, error.code ?? '');
    hits.push(data === true);
  }
  check('rate_limit_hit allows 2 of 3 in a window', hits.join() === 'true,true,false', hits.join());

  const bad = await anon.rpc('rate_limit_hit', { p_key: key, p_max: 0, p_window_seconds: 60 });
  check('rate_limit_hit refuses bad arguments', bad.error?.code === '22023', bad.error?.code ?? 'accepted');

  // Two real accounts: a normal player and an organiser.
  const password = `Migration-${runId}-${Math.random().toString(36).slice(2, 10)}`;
  const users: string[] = [];
  const makeUser = async (suffix: string) => {
    const email = `migration-${suffix}-${runId}@squadsync-e2e.test`;
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Migration test', bgmi_ign: `mt${suffix}_${runId}`.slice(0, 20), region: 'India-South' },
    });
    if (error || !data.user) throw new Error(`could not create test user: ${error?.code}`);
    users.push(data.user.id);
    const client = createClient(url, anonKey, noSession);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`could not sign in: ${signInError.code}`);
    return { client, id: data.user.id };
  };

  try {
    const player = await makeUser('p');
    const organiser = await makeUser('o');
    await db.from('profiles').update({ is_organiser: true }).eq('auth_user_id', organiser.id);

    const playerInsert = await player.client.from('contact_messages').insert(row);
    check('player can insert', !playerInsert.error, playerInsert.error?.code ?? '');

    const playerRead = await player.client.from('contact_messages').select('id').eq('email', marker);
    check('player reads no messages', (playerRead.data ?? []).length === 0, playerRead.error?.code ?? `${playerRead.data?.length} rows`);

    const organiserRead = await organiser.client.from('contact_messages').select('id').eq('email', marker);
    check('organiser can read', (organiserRead.data ?? []).length === 2, organiserRead.error?.code ?? `${organiserRead.data?.length} rows`);

    const update = await organiser.client.from('contact_messages').update({ message: 'changed by a test run' }).eq('email', marker).select('id');
    check('organiser cannot update', !!update.error || (update.data ?? []).length === 0, update.error?.code ?? `${update.data?.length} rows`);

    const del = await organiser.client.from('contact_messages').delete().eq('email', marker).select('id');
    check('organiser cannot delete', !!del.error || (del.data ?? []).length === 0, del.error?.code ?? `${del.data?.length} rows`);
  } finally {
    for (const id of users) await db.auth.admin.deleteUser(id);
    await db.from('contact_messages').delete().eq('email', marker);
    await db.from('rate_limits').delete().eq('key', key);
    const { count } = await db.from('contact_messages').select('id', { count: 'exact', head: true }).eq('email', marker);
    check('cleanup: test messages and users removed', count === 0, `${count ?? '?'} messages left, ${users.length} users deleted`);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
