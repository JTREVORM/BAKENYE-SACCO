import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { MATERIAL_SYMBOLS_HREF } from '@/lib/icons';
import './globals.css';

/**
 * Inter is self-hosted by next/font: no render-blocking request to
 * fonts.googleapis.com, no layout shift, and the file is served from our own
 * origin. The Stitch export linked it from Google; this is the same typeface
 * with a better delivery path for members on slow connections.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: 'BUD-SACCO',
    template: '%s · BUD-SACCO',
  },
  description:
    'Bakenye Unity and Development SACCO — savings, shares and loans for members.',
  applicationName: 'BUD-SACCO',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/brand/bnd-logo.png',
    apple: '/brand/bnd-logo.png',
  },
  formatDetection: { telephone: false },
  // The app is behind a login; there is nothing here for a crawler.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Stitch exported `maximum-scale=1, user-scalable=no`. We deliberately do not
  // carry that over: locking zoom fails WCAG 1.4.4 and the SACCO membership
  // includes older members who rely on pinch-zoom.
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#0a2148',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`light ${inter.variable}`}>
      <head>
        {/* Subsetted icon font — see src/lib/icons.ts for why. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={MATERIAL_SYMBOLS_HREF} />
      </head>
      <body className={`${inter.className} bg-background text-on-background antialiased`}>
        {children}
      </body>
    </html>
  );
}
