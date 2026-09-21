import { describe, expect, it } from 'vitest';

import { scoreBand } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { ROLE_BADGE_CLASS, ROLE_LABELS } from '@/lib/roles';
import { PLAYER_ROLES } from '@/types/database';

describe('cn', () => {
  it('lets a later Tailwind class override an earlier conflicting one', () => {
    expect(cn('px-4 py-2', 'px-2')).toBe('py-2 px-2');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('scoreBand', () => {
  it('bands scores at 45 and 70', () => {
    expect(scoreBand(44.9)).toBe('danger');
    expect(scoreBand(45)).toBe('accent');
    expect(scoreBand(69.9)).toBe('accent');
    expect(scoreBand(70)).toBe('success');
  });
});

describe('role vocabulary', () => {
  it('labels and colours every role in the enum', () => {
    for (const role of PLAYER_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_BADGE_CLASS[role]).toContain(`text-role-${role}`);
    }
  });
});
