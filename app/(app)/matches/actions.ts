'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

import type { ActionResult } from '../actions';

/**
 * Post-match feedback for one teammate.
 *
 * Inserted as the signed-in user so the 0003 policy does the real checking:
 * the rater must be the caller, both players must be seated in the match, and
 * the match must be completed. The zod schema mirrors the table's CHECKs
 * (rating 1-5, teamwork 0-100) only to produce readable field messages.
 *
 * There is no UPDATE path: 0003 revokes UPDATE on match_feedback, so a rating
 * is final once given -- which keeps the label from being revised after the
 * rater sees how the match was scored.
 */
const feedbackSchema = z.object({
  match_id: z.string().uuid(),
  ratee_profile_id: z.string().uuid(),
  rating: z.coerce.number().int().min(1, 'Choose 1 to 5 stars.').max(5, 'Choose 1 to 5 stars.'),
  teamwork_rating: z.coerce.number().int().min(0).max(100),
  would_play_again: z.boolean(),
  comment: z
    .string()
    .trim()
    .max(500, 'Keep the comment under 500 characters.')
    .transform((v) => (v === '' ? null : v)),
});

export async function submitFeedback(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = feedbackSchema.safeParse({
    match_id: formData.get('match_id') ?? '',
    ratee_profile_id: formData.get('ratee_profile_id') ?? '',
    rating: formData.get('rating') ?? '',
    teamwork_rating: formData.get('teamwork_rating') ?? '50',
    would_play_again: formData.get('would_play_again') !== null,
    comment: formData.get('comment') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const { data: me } = await supabase.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!me) return { ok: false, error: 'No profile exists for this account.' };

  const { error } = await supabase.from('match_feedback').insert({
    match_id: parsed.data.match_id,
    rater_profile_id: me.id,
    ratee_profile_id: parsed.data.ratee_profile_id,
    rating: parsed.data.rating as 1 | 2 | 3 | 4 | 5,
    teamwork_rating: parsed.data.teamwork_rating,
    would_play_again: parsed.data.would_play_again,
    comment: parsed.data.comment,
  });

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'You have already rated this teammate for this match.' };
    if (error.code === '42501') {
      return { ok: false, error: 'Feedback opens once the match is marked completed, and only for teammates in it.' };
    }
    return { ok: false, error: 'Could not save your feedback. Try again.' };
  }

  revalidatePath(`/matches/${parsed.data.match_id}`);
  revalidatePath('/analytics');
  return { ok: true };
}
