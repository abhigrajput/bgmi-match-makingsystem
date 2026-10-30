import type { Metadata } from 'next';

import { PublicShell } from '@/components/shell/public-shell';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-xl px-4 py-24 text-center md:px-8">
        <p className="font-mono text-sm text-accent">404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          That page does not exist or has moved. Check the address, or head back to the start.
        </p>
        <ButtonLink href="/" className="mt-6">
          Back to home
        </ButtonLink>
      </div>
    </PublicShell>
  );
}
