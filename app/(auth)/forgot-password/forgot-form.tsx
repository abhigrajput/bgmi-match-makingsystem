'use client';

import { useFormState } from 'react-dom';

import { requestPasswordReset, type AuthFormState } from '../actions';
import { FieldError } from '@/components/form/field-error';
import { SubmitButton } from '@/components/form/submit-button';
import { fieldClass } from '@/components/ui/input';

const initialState: AuthFormState = {};

export function ForgotForm() {
  const [state, formAction] = useFormState(requestPasswordReset, initialState);

  if (state.notice) {
    return (
      <p
        role="status"
        className="rounded-input border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success"
      >
        {state.notice}
      </p>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.formError ? (
        <p
          role="alert"
          className="rounded-input border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          {state.formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-fg">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.values?.email ?? ''}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          className={fieldClass}
        />
        <FieldError id="email-error" messages={state.fieldErrors?.email} />
      </div>

      <SubmitButton label="Send reset link" />
    </form>
  );
}
