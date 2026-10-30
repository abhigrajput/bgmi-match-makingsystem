import { describe, expect, it } from 'vitest';

import { contactSchema } from '../contact';

const valid = { name: 'A Player', email: 'player@squadsync-e2e.test', message: 'A message long enough to send.' };

describe('contactSchema', () => {
  it('accepts a valid message and trims it', () => {
    const parsed = contactSchema.parse({ ...valid, name: '  A Player  ' });
    expect(parsed.name).toBe('A Player');
  });

  it.each([
    ['name', { name: 'A' }],
    ['name', { name: 'x'.repeat(81) }],
    ['email', { email: 'not-an-email' }],
    ['message', { message: 'too short' }],
    ['message', { message: 'x'.repeat(2001) }],
    ['message', { message: '          ' }],
  ])('refuses a bad %s', (field, change) => {
    const result = contactSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });
});
