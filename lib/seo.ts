import type { Metadata } from 'next';

import { APP_NAME } from '@/lib/site';

const OG_IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: `${APP_NAME} social card` };

/**
 * Title, description, canonical, Open Graph and Twitter tags for one page.
 * Paths are made absolute by metadataBase in app/layout.tsx, which is siteUrl().
 * A page setting openGraph replaces the parent's, so every field is restated.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: APP_NAME,
      title,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE.url],
    },
  };
}

/** Pages with nothing for a search engine: auth forms, the signed-in app. */
export const NO_INDEX: Metadata['robots'] = { index: false, follow: false };
