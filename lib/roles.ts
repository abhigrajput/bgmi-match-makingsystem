/**
 * Display vocabulary for the player_role enum.
 *
 * One definition shared by every page, badge and chart. Before the design
 * system each page carried its own ROLE_LABELS copy; five copies of five
 * strings is how "IGL" becomes "Igl" on one screen.
 *
 * The colour classes are spelled out in full rather than built with a template
 * (`text-role-${role}`) because Tailwind finds classes by scanning source text:
 * a class that only exists after string interpolation is never generated.
 */

import type { PlayerRole } from '@/types/database';

export const ROLE_LABELS: Record<PlayerRole, string> = {
  igl: 'IGL',
  assaulter: 'Assaulter',
  sniper: 'Sniper',
  support: 'Support',
  flex: 'Flex',
};

export const ROLE_DESCRIPTIONS: Record<PlayerRole, string> = {
  igl: 'In-game leader: shotcalling and rotations',
  assaulter: 'Entry fragger',
  sniper: 'Long range and DMR',
  support: 'Utility, revives, resupply',
  flex: 'Fills whichever slot the squad lacks',
};

export const ROLE_TEXT_CLASS: Record<PlayerRole, string> = {
  igl: 'text-role-igl',
  assaulter: 'text-role-assaulter',
  sniper: 'text-role-sniper',
  support: 'text-role-support',
  flex: 'text-role-flex',
};

export const ROLE_BADGE_CLASS: Record<PlayerRole, string> = {
  igl: 'border-role-igl/40 bg-role-igl/10 text-role-igl',
  assaulter: 'border-role-assaulter/40 bg-role-assaulter/10 text-role-assaulter',
  sniper: 'border-role-sniper/40 bg-role-sniper/10 text-role-sniper',
  support: 'border-role-support/40 bg-role-support/10 text-role-support',
  flex: 'border-role-flex/40 bg-role-flex/10 text-role-flex',
};

/**
 * Raw colours for recharts, which paints SVG fills from props and cannot read
 * a Tailwind class. CSS variables still work there, so the light theme holds.
 */
export const ROLE_CHART_COLOR: Record<PlayerRole, string> = {
  igl: 'rgb(var(--role-igl))',
  assaulter: 'rgb(var(--role-assaulter))',
  sniper: 'rgb(var(--role-sniper))',
  support: 'rgb(var(--role-support))',
  flex: 'rgb(var(--role-flex))',
};
