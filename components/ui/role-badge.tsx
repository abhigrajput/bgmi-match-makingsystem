import { Crosshair, Crown, HeartPulse, Shuffle, Swords } from 'lucide-react';

import { cn } from '@/lib/cn';
import { ROLE_BADGE_CLASS, ROLE_LABELS } from '@/lib/roles';
import type { PlayerRole } from '@/types/database';

const ICON: Record<PlayerRole, typeof Crown> = {
  igl: Crown,
  assaulter: Swords,
  sniper: Crosshair,
  support: HeartPulse,
  flex: Shuffle,
};

/**
 * Role chip. Icon AND label, never colour alone: five hues are the whole
 * encoding, and roughly one in twelve men cannot tell the assaulter red from
 * the support green.
 */
export function RoleBadge({
  role,
  className,
  size = 'md',
}: {
  role: PlayerRole;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const Icon = ICON[role];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        size === 'sm' ? 'px-1.5 py-0 text-[11px]' : 'px-2 py-0.5 text-xs',
        ROLE_BADGE_CLASS[role],
        className,
      )}
    >
      <Icon aria-hidden="true" className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {ROLE_LABELS[role]}
    </span>
  );
}
