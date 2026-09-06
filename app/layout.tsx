import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Squad Recommendation System',
  description:
    'Skill-based team matching for BGMI: grouping players by measured skill, role, availability, and peer feedback rather than queue order.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
