import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/site';

const PUBLIC_PATHS = ['/', '/contact', '/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: `${siteUrl()}${path === '/' ? '' : path}` }));
}
