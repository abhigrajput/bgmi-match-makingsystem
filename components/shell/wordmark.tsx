import Link from 'next/link';
import { Crosshair } from 'lucide-react';

import { cn } from '@/lib/cn';
import { APP_NAME, APP_TAGLINE } from '@/lib/site';

/**
 * The logo: a crosshair mark and the product name, always a link home. The one
 * place it is drawn, so the header, the auth pages and the app shell match.
 */
export function Wordmark({
  tagline = false,
  className,
}: {
  tagline?: boolean;
  className?: string;
}) {
  return (
    <Link href="/" className={cn('inline-flex min-h-11 items-center gap-2.5', className)}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-input bg-accent text-accent-fg">
        <Crosshair aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-fg">{APP_NAME}</span>
        {tagline ? <span className="block text-xs text-muted">{APP_TAGLINE}</span> : null}
      </span>
    </Link>
  );
}
