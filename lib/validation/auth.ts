/**
 * Zod schemas for the login and signup forms.
 *
 * These live in lib/ rather than beside the forms because they are parsed
 * twice: once in the Server Action that performs the signup, and once by the
 * form component to shape the error state it renders. Client-side validation is
 * a convenience -- it is trivially bypassed by anyone posting directly to the
 * action -- so the server parse is the one that decides, and both must be the
 * same schema or the two will drift.
 *
 * The constraints here mirror 0001_init.sql where the database has an opinion.
 * That duplication is deliberate: a NOT NULL / CHECK violation surfacing from
 * Postgres is a 500 with a constraint name in it, while a zod failure is a
 * sentence under the right input. The database is the guarantee; this is the
 * error message.
 */

import { z } from 'zod';

/**
 * Email is validated but never normalised beyond trimming. Lower-casing it
 * would be wrong: the local part of an address is case-sensitive per RFC 5321,
 * and Supabase treats the address as given.
 */
export const emailSchema = z
  .email({ message: 'Enter a valid email address.' })
  .trim()
  .max(254, { message: 'Email address is too long.' });

/**
 * Supabase enforces a 6-character minimum by default. 8 is used here because
 * the difference in friction is negligible and the difference in a brute-force
 * search space is four orders of magnitude.
 *
 * No composition rules (an uppercase, a digit, a symbol). They push users
 * toward `Password1!` and measurably reduce entropy; length is the property
 * that matters. The upper bound exists because bcrypt truncates at 72 bytes,
 * so anything past it is silently ignored rather than making the password
 * stronger -- better to say so than to accept it and pretend.
 */
export const passwordSchema = z
  .string()
  .min(8, { message: 'Password must be at least 8 characters.' })
  .max(72, { message: 'Password must be 72 characters or fewer.' });

/**
 * Mirrors profiles.display_name: NOT NULL with a
 * `length(btrim(display_name)) > 0` check. Trimmed first so that a field of
 * spaces fails here rather than at the constraint.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Display name must be at least 2 characters.' })
  .max(40, { message: 'Display name must be 40 characters or fewer.' });

/**
 * Mirrors profiles.bgmi_ign: NOT NULL, UNIQUE, non-blank.
 *
 * The character restriction is stricter than the database, which accepts any
 * non-blank text. It is here because this column is the key used to reconcile
 * external BGMI match records back to a profile: a name containing whitespace
 * or control characters is a name that will not match cleanly on import, and
 * the failure would show up much later as missing match history rather than as
 * a rejected signup.
 *
 * Uniqueness is NOT checked here. It cannot be -- it is a question about the
 * whole table at a moment in time, and any answer this schema could give would
 * already be stale. The UNIQUE constraint decides, handle_new_user() turns the
 * violation into a 23505, and the signup action maps that back onto this field.
 */
export const bgmiIgnSchema = z
  .string()
  .trim()
  .min(3, { message: 'In-game name must be at least 3 characters.' })
  .max(30, { message: 'In-game name must be 30 characters or fewer.' })
  .regex(/^[A-Za-z0-9._-]+$/, {
    message:
      'In-game name may contain only letters, numbers, dots, underscores and hyphens.',
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`. Applying the signup rules to a login field means an
  // account created before the rules changed can no longer sign in, and it
  // tells an attacker the password policy for free. A login either matches or
  // it does not; only presence is checked.
  password: z.string().min(1, { message: 'Enter your password.' }),
});

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: displayNameSchema,
  bgmi_ign: bgmiIgnSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
