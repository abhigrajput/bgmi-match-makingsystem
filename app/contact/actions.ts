'use server';

import { z } from 'zod';

import { SERVICE_UNAVAILABLE_MESSAGE } from '@/lib/auth/errors';
import { underRateLimit } from '@/lib/rate-limit';
import { missingSupabaseConfig } from '@/lib/supabase/config';
import { createAnonClient } from '@/lib/supabase/server';
import { contactSchema } from '@/lib/validation/contact';

export interface ContactFormState {
  fieldErrors?: Partial<Record<string, string[]>>;
  formError?: string;
  notice?: string;
  values?: Partial<Record<string, string>>;
}

const SENT = 'Thanks, your message has been sent.';

/** Stores a message. Runs as anon, so RLS and 0009's constraints apply to it. */
export async function sendContactMessage(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  // A field people cannot see. Filled means a bot: it is told the message went
  // through, so it learns nothing, and nothing is stored.
  if (String(formData.get('website') ?? '') !== '') return { notice: SENT };

  const raw = {
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    message: String(formData.get('message') ?? ''),
  };

  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: raw };
  }

  if (missingSupabaseConfig().length > 0) {
    return { formError: SERVICE_UNAVAILABLE_MESSAGE, values: raw };
  }

  if (!(await underRateLimit('contact'))) {
    return { formError: 'Too many messages from this connection. Please try again in an hour.', values: raw };
  }

  const { error } = await createAnonClient().from('contact_messages').insert(parsed.data);
  if (error) {
    console.error(`contact: insert failed (${error.code ?? 'no code'})`);
    return { formError: 'Could not send your message. Please try again.', values: raw };
  }

  return { notice: SENT };
}
