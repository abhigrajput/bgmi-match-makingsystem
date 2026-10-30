import Link from 'next/link';

import { APP_NAME } from '@/lib/site';

import { CopyrightYear } from './copyright-year';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/contact', label: 'Contact' },
  { href: '/login', label: 'Log in' },
  { href: '/signup', label: 'Sign up' },
];

const TEAM = ['Abhishek GR', 'Shivakumar SH', 'Aishwarya YH', 'Aniketana SD'];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm md:grid-cols-2 md:px-8">
        <div>
          <p className="font-medium text-fg">Team</p>
          <p className="mt-1 text-muted">{TEAM.join(' · ')}</p>
          <p className="mt-1 text-muted">Guide: Dr. Vishwanath K</p>
          <p className="mt-1 text-muted">KLE Institute of Technology, Hubballi</p>
        </div>
        <nav aria-label="Footer" className="md:justify-self-end">
          <ul className="flex flex-wrap gap-x-5">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-fg"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-xs text-muted md:col-span-2">
          © <CopyrightYear /> {APP_NAME}. Academic prototype. Not affiliated with Krafton or BGMI.
        </p>
      </div>
    </footer>
  );
}
