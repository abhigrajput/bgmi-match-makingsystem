'use client';

import { useEffect, useId, useState } from 'react';
import { useFormState } from 'react-dom';
import { Star } from 'lucide-react';

import { SubmitButton } from '@/components/form/submit-button';
import { FieldError } from '@/components/ui/field-error';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

import { submitFeedback } from '@/app/(app)/matches/actions';
import type { ActionResult } from '@/app/(app)/actions';

/**
 * Feedback for one teammate: 1-5 stars, a 0-100 teamwork slider, "would play
 * again", and an optional comment.
 *
 * The stars are a radio group, not five buttons: a radio group is one Tab
 * stop, arrow keys move the choice, and the value posts with the form with no
 * JavaScript. The visible stars are labels for visually hidden radios.
 */
export function FeedbackForm({
  matchId,
  rateeId,
  rateeIgn,
}: {
  matchId: string;
  rateeId: string;
  rateeIgn: string;
}) {
  const [state, action] = useFormState(submitFeedback, null as ActionResult | null);
  const [rating, setRating] = useState(0);
  const toast = useToast();
  const id = useId();

  useEffect(() => {
    if (state?.ok) toast('success', `Feedback for ${rateeIgn} saved.`);
  }, [state, rateeIgn, toast]);

  if (state?.ok) {
    return <p className="text-sm text-success">Thanks — your rating for {rateeIgn} is saved.</p>;
  }

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="match_id" value={matchId} />
      <input type="hidden" name="ratee_profile_id" value={rateeId} />

      {state && !state.ok ? (
        <p role="alert" className="rounded-input border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-fg">How was playing with {rateeIgn}?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
                required
              />
              <span className="sr-only">
                {value} star{value > 1 ? 's' : ''}
              </span>
              <Star
                aria-hidden="true"
                className={cn(
                  'h-7 w-7 rounded transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent',
                  value <= rating ? 'fill-accent text-accent' : 'text-border-strong hover:text-accent/60',
                )}
              />
            </label>
          ))}
        </div>
        <FieldError id={`${id}-rating`} messages={fieldErrors?.rating} />
      </fieldset>

      <div>
        <Label htmlFor={`${id}-teamwork`}>Teamwork</Label>
        <Slider id={`${id}-teamwork`} name="teamwork_rating" defaultValue={60} aria-label={`Teamwork rating for ${rateeIgn}, 0 to 100`} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id={`${id}-again`}
          name="would_play_again"
          type="checkbox"
          defaultChecked
          className="h-4 w-4 rounded border-border accent-[rgb(var(--accent))]"
        />
        <label htmlFor={`${id}-again`} className="text-sm text-fg">
          I would play with {rateeIgn} again
        </label>
      </div>

      <div>
        <Label htmlFor={`${id}-comment`} optional>
          Comment
        </Label>
        <Textarea id={`${id}-comment`} name="comment" rows={2} maxLength={500} />
        <FieldError id={`${id}-comment-error`} messages={fieldErrors?.comment} />
      </div>

      <SubmitButton label="Submit rating" fullWidth={false} />
    </form>
  );
}
