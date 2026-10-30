import Link from 'next/link';

import { PublicShell } from './public-shell';

export const LEGAL_UPDATED = '30 October 2026';

const linkClass = 'inline-flex min-h-11 items-center font-medium text-data hover:underline';

/** A link inside legal text, tall enough to tap. */
export function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-6 text-muted [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({
  title,
  signedIn,
  children,
}: {
  title: string;
  signedIn: boolean;
  children: React.ReactNode;
}) {
  return (
    <PublicShell signedIn={signedIn}>
      <article className="mx-auto max-w-3xl px-4 py-12 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
        {children}
      </article>
    </PublicShell>
  );
}
