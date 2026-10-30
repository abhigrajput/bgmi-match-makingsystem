'use client';

/**
 * Read in the browser, so a page prerendered last December still shows this
 * year. The warning is suppressed for that one case, where the two differ.
 */
export function CopyrightYear() {
  return <span suppressHydrationWarning>{new Date().getFullYear()}</span>;
}
