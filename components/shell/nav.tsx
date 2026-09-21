'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Crosshair,
  LayoutDashboard,
  LogOut,
  Swords,
  Trophy,
  User,
  Users,
} from 'lucide-react';

import { Avatar } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { APP_NAME } from '@/lib/site';

/**
 * The seven sections of the signed-in app. One list drives both the desktop
 * sidebar and the mobile tab bar, so the two cannot disagree about what
 * exists.
 */
export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tournaments', label: 'Tournaments', icon: Swords },
  { href: '/players', label: 'Players', icon: Users },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/matches', label: 'Matches', icon: Crosshair },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/profile', label: 'Profile', icon: User },
] as const;

/**
 * Prefix match, so /tournaments/hubballi-weekend-cup keeps "Tournaments" lit.
 * /profile/availability is under Profile for the same reason.
 */
function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  displayName,
  ign,
  avatarUrl,
}: {
  displayName: string;
  ign: string;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface md:flex">
      <Link
        href="/dashboard"
        className="flex h-16 items-center gap-2.5 border-b border-border px-5"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-input bg-accent text-accent-fg">
          <Crosshair aria-hidden="true" className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold leading-tight text-fg">
          {APP_NAME}
          <span className="block text-[11px] font-normal text-muted">
            BGMI matchmaking
          </span>
        </span>
      </Link>

      <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-input px-3 py-2 text-sm transition-colors duration-150',
                active
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={displayName} src={avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{displayName}</p>
            <p className="truncate font-mono text-xs text-muted">{ign}</p>
          </div>
        </div>
        {/*
          A plain POST form: /auth/signout is POST-only because a sign-out
          reachable by GET can be fired by any <img> on any site.
        */}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-input px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

export function MobileTopBar({ displayName }: { displayName: string }) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-input bg-accent text-accent-fg">
          <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold">{APP_NAME}</span>
      </Link>
      <form action="/auth/signout" method="post" className="flex items-center gap-2">
        <span className="max-w-[9rem] truncate text-xs text-muted">{displayName}</span>
        <button
          type="submit"
          aria-label="Sign out"
          className="rounded-input p-2 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
        </button>
      </form>
    </header>
  );
}

/**
 * Bottom tab bar on phones. All seven sections, icon over a short label: a
 * "More" menu would hide Analytics and Players behind a second tap, and at
 * 375px seven 53px targets still clear the 44px minimum.
 */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur md:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px]',
              active ? 'text-accent' : 'text-muted',
            )}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
