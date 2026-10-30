'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Banner } from '@/components/form/banner';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Hint, Label } from '@/components/ui/label';
import { AUTH_FORM_MESSAGES, classifyAuthError } from '@/lib/auth/errors';
import { createClient } from '@/lib/supabase/client';
import { missingSupabaseConfig } from '@/lib/supabase/config';
import { passwordSchema } from '@/lib/validation/auth';

const COPY = {
  invite: {
    checking: 'Checking your invite…',
    problemTitle: 'Invite link problem',
    expired: 'This invite link has expired. Ask for a new one.',
    unusable: 'This invite link could not be used. Ask for a new one.',
    missing: 'This link is missing its sign-in details. Open the invite link from your email again.',
    title: 'Set your password',
    intro: 'Choose a password to finish setting up your account.',
    submit: 'Save password and continue',
  },
  reset: {
    checking: 'Checking your reset link…',
    problemTitle: 'Reset link problem',
    expired: 'This reset link has expired. Ask for a new one.',
    unusable: 'This reset link could not be used. Ask for a new one.',
    missing: 'This link is missing its sign-in details. Open the reset link from your email again.',
    title: 'Choose a new password',
    intro: 'Pick something you have not used here before.',
    submit: 'Save new password',
  },
} as const;

type Phase =
  | { kind: 'checking' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; email: string | null }
  | { kind: 'saving'; email: string | null };

/**
 * Reads the session out of the link's fragment, then asks for a password.
 *
 * setSession() rather than relying on the client's automatic URL detection:
 * the browser client runs the PKCE flow, and whether it also accepts an
 * implicit-flow fragment varies by library version. Parsing the two tokens
 * and handing them over is explicit and version-proof.
 *
 * The fragment is wiped from the address bar as soon as it is read, so the
 * tokens do not linger in history or leak through a copied URL.
 */
export function AcceptInvite({
  next,
  mode = 'invite',
}: {
  next: string;
  mode?: keyof typeof COPY;
}) {
  const router = useRouter();
  const copy = COPY[mode];
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // createClient() throws without configuration, which would replace this
    // whole page with the framework's error screen.
    if (missingSupabaseConfig().length > 0) {
      setPhase({ kind: 'invalid', message: AUTH_FORM_MESSAGES.service_unavailable });
      return;
    }

    const supabase = createClient();
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    async function run() {
      const linkError = params.get('error_description');
      if (linkError) {
        setPhase({
          kind: 'invalid',
          message: /expired/i.test(linkError) ? copy.expired : copy.unusable,
        });
        return;
      }

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error || !data.user) {
          setPhase({ kind: 'invalid', message: copy.unusable });
          return;
        }
        // A confirmation email resent through /auth/callback: the account
        // already has a password, so signing in is all there is to do.
        if (params.get('type') === 'signup' || params.get('type') === 'email') {
          router.replace(next);
          router.refresh();
          return;
        }
        setPhase({ kind: 'ready', email: data.user.email ?? null });
        return;
      }

      // No tokens: fine if already signed in (e.g. a reload after setSession).
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setPhase({ kind: 'ready', email: user.email ?? null });
      else
        setPhase({
          kind: 'invalid',
          message: copy.missing,
        });
    }

    void run();
    // Runs once: the fragment is wiped above, so a re-run would find no tokens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFieldError(null);
    setFormError(null);
    // The same schema as signup, so the two rules cannot drift.
    const checked = passwordSchema.safeParse(password);
    if (!checked.success) {
      setFieldError(checked.error.issues[0]?.message ?? 'Choose a longer password.');
      return;
    }
    if (password !== confirm) {
      setFieldError('The two passwords do not match.');
      return;
    }
    if (phase.kind !== 'ready') return;
    setPhase({ kind: 'saving', email: phase.email });
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      const kind = classifyAuthError(error);
      setFormError(
        error.code === 'same_password'
          ? 'That is your current password. Choose a different one.'
          : kind === 'unknown'
            ? 'Could not save your password. Try again.'
            : AUTH_FORM_MESSAGES[kind],
      );
      setPhase({ kind: 'ready', email: phase.email });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (phase.kind === 'checking') {
    return (
      <p role="status" className="text-sm text-muted">
        {copy.checking}
      </p>
    );
  }

  if (phase.kind === 'invalid') {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-fg">{copy.problemTitle}</h1>
        <Banner tone="error">{phase.message}</Banner>
        <p className="text-sm text-muted">
          Already set a password?{' '}
          <Link href="/login" className="inline-flex min-h-11 min-w-11 items-center font-medium text-data hover:underline">
            Sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-fg">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {phase.email ? (
            <>
              You are signed in as <span className="text-fg">{phase.email}</span>.{' '}
            </>
          ) : null}
          {copy.intro}
        </p>
      </div>

      {formError ? <Banner tone="error">{formError}</Banner> : null}

      <div>
        <Label htmlFor="new-password">Password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="new-password-hint"
        />
        <Hint id="new-password-hint">At least 10 characters.</Hint>
      </div>

      <div>
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'password-error' : undefined}
        />
        <FieldError id="password-error" messages={fieldError ? [fieldError] : undefined} />
      </div>

      <Button type="submit" className="w-full" loading={phase.kind === 'saving'}>
        {copy.submit}
      </Button>
    </form>
  );
}
