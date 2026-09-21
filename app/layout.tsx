import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { ToastProvider } from '@/components/ui/toast';
import { APP_NAME, APP_TAGLINE } from '@/lib/site';

import './globals.css';

/**
 * Both fonts are self-hosted by next/font at build time: no request to Google
 * from the visitor's browser, and no layout shift while a webfont swaps in.
 * Exposed as CSS variables so tailwind.config.ts can name them.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Skill-based team matching for BGMI: grouping players by measured skill, role, availability, and peer feedback rather than queue order.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0B0D12' },
    { media: '(prefers-color-scheme: light)', color: '#F6F7F9' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
