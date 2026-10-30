import { PublicHeader } from './public-header';
import { SiteFooter } from './site-footer';

/** Header, main and footer for every public page. */
export function PublicShell({
  signedIn = false,
  children,
}: {
  signedIn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-input focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Skip to content
      </a>
      <PublicHeader signedIn={signedIn} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
