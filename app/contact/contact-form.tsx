'use client';

import { useFormState } from 'react-dom';

import { Banner } from '@/components/form/banner';
import { FieldError } from '@/components/form/field-error';
import { SubmitButton } from '@/components/form/submit-button';
import { fieldClass } from '@/components/ui/input';

import { sendContactMessage, type ContactFormState } from './actions';

const initialState: ContactFormState = {};

export function ContactForm() {
  const [state, formAction] = useFormState(sendContactMessage, initialState);

  if (state.notice) return <Banner tone="success">{state.notice}</Banner>;

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.formError ? <Banner tone="error">{state.formError}</Banner> : null}

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-fg">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          defaultValue={state.values?.name ?? ''}
          aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          className={fieldClass}
        />
        <FieldError id="name-error" messages={state.fieldErrors?.name} />
      </div>

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

      <div>
        <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-fg">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          defaultValue={state.values?.message ?? ''}
          aria-describedby={state.fieldErrors?.message ? 'message-error' : undefined}
          aria-invalid={state.fieldErrors?.message ? true : undefined}
          className={fieldClass}
        />
        <FieldError id="message-error" messages={state.fieldErrors?.message} />
      </div>

      {/* The honeypot. Off-screen rather than display:none, which bots skip. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <SubmitButton label="Send message" />
    </form>
  );
}
