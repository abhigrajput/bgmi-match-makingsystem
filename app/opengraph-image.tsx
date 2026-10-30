import { ImageResponse } from 'next/og';

import { APP_NAME, APP_TAGLINE, siteUrl } from '@/lib/site';

export const alt = `${APP_NAME}: ${APP_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: '#0B0D12',
          color: '#E7E9EE',
        }}
      >
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, color: '#F5A524' }}>{APP_NAME}</div>
        <div style={{ display: 'flex', marginTop: 24, fontSize: 44 }}>{APP_TAGLINE}</div>
        <div style={{ display: 'flex', marginTop: 56, fontSize: 28, color: '#8A91A0' }}>
          {new URL(siteUrl()).host}
        </div>
      </div>
    ),
    size,
  );
}
