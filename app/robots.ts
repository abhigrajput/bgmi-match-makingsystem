import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/site';

/**
 * Only machine endpoints are disallowed. Auth and signed-in pages stay crawlable
 * on purpose: they carry a noindex tag, and a crawler barred from a page cannot
 * read its noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
