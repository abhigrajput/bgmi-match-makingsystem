'use server';

/**
 * Server Actions for the login and signup forms.
 *
 * Both forms post here rather than to a route handler so that validation,
 * the Supabase call, and the redirect happen in one server round trip with no
 * client-side fetch to keep in sync. The `'use server'` directive means
 * everything in this file runs only on the server -- nothing here is bundled
 * for the browser -- which is why it can safely be the only place that shapes
 * auth error messages.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { loginSchema, signupSchema } from '@/lib/validation/auth';

/**
 * What a form action hands back to `useFormState`.
 *
 * Success is not represented here, because success does not return: both
 * actions end in `redirect()`, which throws a control-flow signal that Next.js
 * catches. The one exception is `notice`, used for the signup path that
 * genuinely has nothing to redirect to yet.
 */
export interface AuthFormState {
  /** Errors keyed by form field name. Rendered under the matching input. */
  fieldErrors?: Partial<Record<string, string[]>>;
  /** An error about the submission as a whole. Rendered above the form. */
  formError?: string;
  /** A non-error outcome that is not a redirect -- e.g. "confirm your email". */
  notice?: string;
  /** Echoed back so the user does not retype everything after a failure. */
  values?: Partial<Record<string, string>>;
}

/**
 * `redirect()` works by throwing. Any `try` around it would catch that throw
 * and turn a successful login into a generic error, so both actions below call
 * it outside their error handling rather than at the end of a try block.
 */

export async function login(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  };

  const parsed = loginSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      // The password is never echoed back. Re-rendering it would put the
      // plaintext into the HTML response and into any intermediary that logs
      // response bodies.
      values: { email: raw.email },
    };
  }

  const supabase = createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    /**
     * One message for every failure mode, attached to the form rather than to
     * a field. Distinguishing "no such account" from "wrong password" turns
     * this form into an account-enumeration oracle: an attacker submits a list
     * of email addresses and learns which ones are registered, which is a
     * finding on its own and the first step of a credential-stuffing run.
     *
     * The real error is not logged either -- Supabase's message can contain
     * the submitted address.
     */
    return {
      formError: 'Incorrect email or password.',
      values: { email: parsed.data.email },
    };
  }

  // The session cookie was set by the Supabase client during the action, but
  // any already-rendered layout was built for a signed-out user. Without this,
  // the redirect can land on a cached shell that still thinks nobody is
  // signed in.
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signup(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    display_name: String(formData.get('display_name') ?? ''),
    bgmi_ign: String(formData.get('bgmi_ign') ?? ''),
  };

  const echo = {
    email: raw.email,
    display_name: raw.display_name,
    bgmi_ign: raw.bgmi_ign,
  };

  const parsed = signupSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: echo,
    };
  }

  const supabase = createClient();

  // Origin is read from the request rather than from NEXT_PUBLIC_APP_URL so
  // that preview deployments and localhost each send a confirmation link back
  // to themselves instead of to production.
  const origin = headers().get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,

      /**
       * This object becomes `raw_user_meta_data` on the new auth.users row,
       * and it is the entire input to handle_new_user() -- the 0002 trigger
       * reads `display_name` and `bgmi_ign` out of it to build the profile.
       *
       * The client never inserts into profiles itself; it has no INSERT
       * privilege on that table and 0003 grants no policy for one. Passing the
       * values through metadata is how they cross into a transaction the
       * client does not control.
       *
       * Keys must match what the trigger reads. Renaming one here without
       * changing 0002 does not fail loudly: the trigger falls back to a
       * generated placeholder and the user silently gets the wrong IGN.
       */
      data: {
        display_name: parsed.data.display_name,
        bgmi_ign: parsed.data.bgmi_ign,
      },
    },
  });

  if (error) {
    /**
     * The bgmi_ign collision path.
     *
     * handle_new_user() raises SQLSTATE 23505 with a message naming the taken
     * IGN, and that abort rolls back the auth.users insert with it -- so there
     * is no half-created account and retrying with a different name works.
     *
     * Getting that error back out through GoTrue is the awkward part. It sits
     * between the trigger and this code and does not preserve SQLSTATE, so the
     * check has to cover both what it passes through and what it replaces the
     * error with. `Database error saving new user` is GoTrue's generic wrapper
     * for any exception raised by this trigger -- and since the IGN collision
     * is the only failure the trigger raises by design, attributing it to that
     * field is right far more often than a generic message would be.
     */
    const message = error.message ?? '';
    const isIgnCollision =
      message.includes('already taken') ||
      message.includes('bgmi_ign') ||
      message.includes('Database error saving new user');

    if (isIgnCollision) {
      return {
        fieldErrors: {
          bgmi_ign: [
            'That in-game name is already taken. Choose another one.',
          ],
        },
        values: echo,
      };
    }

    if (message.toLowerCase().includes('already registered')) {
      // Supabase's own wording for a duplicate email. This one is attached to
      // the field because Supabase has already disclosed it -- pretending
      // otherwise would leave the user stuck with no idea what to change.
      return {
        fieldErrors: { email: ['An account with this email already exists.'] },
        values: echo,
      };
    }

    return {
      formError: 'Could not create the account. Please try again.',
      values: echo,
    };
  }

  /**
   * With email confirmation enabled -- the Supabase default -- signUp()
   * succeeds but returns no session: the account exists and the profile has
   * been provisioned by the trigger, but the user is not signed in until they
   * click the link. Redirecting to /dashboard here would bounce straight back
   * to /login via the middleware and look like a failed signup.
   *
   * With confirmation disabled, a session is returned and the redirect below
   * runs. Both configurations are supported without a settings flag because
   * the response says which one is in effect.
   */
  if (!data.session) {
    return {
      notice:
        'Account created. Check your email for a confirmation link to finish signing in.',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
