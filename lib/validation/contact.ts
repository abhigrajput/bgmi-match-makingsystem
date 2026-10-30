import { z } from 'zod';

import { emailSchema } from '@/lib/validation/auth';

/** Lengths match the check constraints in 0009. */
export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(80, 'Use 80 characters or fewer.'),
  email: emailSchema,
  message: z
    .string()
    .trim()
    .min(10, 'Write at least 10 characters.')
    .max(2000, 'Use 2000 characters or fewer.'),
});

export type ContactInput = z.infer<typeof contactSchema>;
