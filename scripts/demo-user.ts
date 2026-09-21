/**
 * scripts/demo-user.ts -- create (or refresh) a signed-in demo account with a
 * complete profile, for walkthroughs and screenshots.
 *
 *   npx tsx scripts/demo-user.ts --target local
 *
 * LOCAL ONLY. Refuses prod: a known password on a production account is a
 * standing credential leak, and production accounts are made through /signup.
 */

import { parseTarget, serviceClient } from './lib/env';

const EMAIL = 'demo.player@squadsync.local';
const PASSWORD = 'demo-password-123';

async function main() {
  const target = parseTarget();
  if (target !== 'local') throw new Error('demo-user.ts only runs against --target local.');
  const db = serviceClient(target);

  const { data: list } = await db.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === EMAIL);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Demo Player', bgmi_ign: 'DemoKaalOP' },
    });
    if (error || !data.user) throw new Error(error?.message ?? 'createUser failed');
    user = data.user;
  }

  const { data: profile, error } = await db.from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (error || !profile) throw new Error('No profile row -- is the on_auth_user_created trigger installed?');

  await db.from('profiles').update({ region: 'India-South', bio: 'IGL main. Evenings after 8.' }).eq('id', profile.id);
  await db.from('player_preferences').upsert(
    {
      profile_id: profile.id,
      primary_role: 'igl',
      secondary_role: 'support',
      comm_preference: 'voice_optional',
      languages: ['en', 'hi', 'kn'],
      min_teammate_skill: 30,
      max_teammate_skill: 85,
    },
    { onConflict: 'profile_id' },
  );
  await db.from('player_availability').delete().eq('profile_id', profile.id);
  await db.from('player_availability').insert(
    [1, 3, 5, 6].map((day) => ({
      profile_id: profile.id,
      day_of_week: day as 1 | 3 | 5 | 6,
      start_minute: 1200,
      end_minute: 1440,
      timezone_offset_minutes: 330,
    })),
  );
  await db.from('player_stats').upsert(
    {
      profile_id: profile.id,
      kd_ratio: 2.1, avg_damage: 390, avg_survival_time: 1180, headshot_rate: 22, win_rate: 12,
      aim_score: 61, game_sense: 68, teamwork_score: 72, clutch_score: 58, consistency_score: 63,
      overall_rating: 64, matches_played: 180, matches_won: 22,
      last_computed_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );
  console.log(`Demo account ready on local: ${EMAIL}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
