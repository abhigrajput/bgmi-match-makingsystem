import { describe, expect, it } from 'vitest';

import { pageMetadata } from '../seo';

describe('pageMetadata', () => {
  const metadata = pageMetadata({ title: 'A title', description: 'A description', path: '/contact' });

  it('sets the canonical from the path', () => {
    expect(metadata.alternates?.canonical).toBe('/contact');
  });

  it('gives Open Graph and Twitter the same text and a 1200x630 image', () => {
    expect(metadata.openGraph).toMatchObject({
      title: 'A title',
      description: 'A description',
      url: '/contact',
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'A title',
      description: 'A description',
      images: ['/og-image.png'],
    });
  });

  it('bypasses the title template, so the title is exactly as given', () => {
    expect(metadata.title).toEqual({ absolute: 'A title' });
  });
});
