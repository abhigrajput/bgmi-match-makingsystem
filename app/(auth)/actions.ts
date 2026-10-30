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

import {
  AUTH_FORM_MESSAGES,
  classifyAuthError,
  logAuthFailure,
  type AuthFailure,
} from '@/lib/auth/errors';
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
     * Attached to the form rather than to a field. Wrong email and wrong
     * password share one message: distinguishing "no such account" from "wrong
     * password" turns this form into an account-enumeration oracle.
     *
     * But an outage or a rate limit is NOT a wrong password, and saying so
     * sends users with correct credentials off to reset them (Task.md, H).
     * Those get their own messages. Kinds that cannot arise from a sign-in
     * fall back to the generic one.
     */
    const kind = classifyAuthError(error);
    logAuthFailure('login', kind, error);

    const loginKinds = new Set<AuthFailure>([
      'invalid_credentials',
      'email_not_confirmed',
      'rate_limited',
      'service_unavailable',
    ]);

    return {
      formError: AUTH_FORM_MESSAGES[loginKinds.has(kind) ? kind : 'unknown'],
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
     * handle_new_user() raises 23505 for a taken IGN, which rolls back the
     * auth.users insert with it -- no half-created account, and retrying with
     * another name works. How that and the other failures are told apart is in
     * lib/auth/errors.ts.
     *
     * Problems the user fixes in one field are attached to that field. A
     * duplicate email is attached to the email field because Supabase has
     * already disclosed it -- hiding it would leave the user stuck. Everything
     * else (rate limit, outage) is about the submission as a whole.
     */
    const kind = classifyAuthError(error);
    logAuthFailure('signup', kind, error);

    const field =
      kind === 'ign_taken'
        ? 'bgmi_ign'
        : kind === 'email_taken'
          ? 'email'
          : kind === 'weak_password'
            ? 'password'
            : null;

    if (field) {
      return {
        fieldErrors: { [field]: [AUTH_FORM_MESSAGES[kind]] },
        values: echo,
      };
    }

    return {
      formError:
        kind === 'rate_limited' || kind === 'service_unavailable'
          ? AUTH_FORM_MESSAGES[kind]
          : 'Could not create the account. Please try again.',
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
