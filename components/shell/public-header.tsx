'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';

import { ButtonLink, buttonClass } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

import { Wordmark } from './wordmark';

const SECTION_LINKS = [
  { href: '/#how-heading', label: 'How it works' },
  { href: '/contact', label: 'Contact' },
];

const textLink = 'inline-flex min-h-11 items-center text-sm text-muted transition-colors duration-150 hover:text-fg';

/**
 * Header for the public pages. On phones the links move into a modal menu:
 * Dialog is a native <dialog>, so focus is trapped inside it, Escape closes it
 * and focus returns to the menu button.
 */
export function PublicHeader({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
      <Wordmark />

      <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
        {SECTION_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className={textLink}>
            {link.label}
          </Link>
        ))}
        <div className="flex gap-2">
          {signedIn ? (
            <ButtonLink href="/dashboard" size="sm">
              Go to dashboard
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Sign up
              </ButtonLink>
            </>
          )}
        </div>
      </nav>

      <button
        type="button"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={buttonClass('secondary', 'sm', 'w-11 px-0 md:hidden')}
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </button>

      <Dialog open={open} onClose={close} title="Menu">
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {SECTION_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={close} className={textLink}>
              {link.label}
            </Link>
          ))}
          <div className="mt-3 flex flex-col gap-2">
            {signedIn ? (
              <Link href="/dashboard" onClick={close} className={buttonClass('primary', 'md')}>
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link href="/signup" onClick={close} className={buttonClass('primary', 'md')}>
                  Sign up
                </Link>
                <Link href="/login" onClick={close} className={buttonClass('secondary', 'md')}>
                  Log in
                </Link>
              </>
            )}
          </div>
        </nav>
      </Dialog>
    </header>
  );
}
