import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { MATERIAL_SYMBOLS_HREF } from '@/lib/icons';
import { BrandProvider } from '@/components/brand/BrandProvider';
import { InstallEventCapture } from '@/components/pwa/InstallEventCapture';
import { ServiceWorker } from '@/components/pwa/ServiceWorker';
import { getBrand } from '@/lib/brand';
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

/**
 * Page metadata, from the organisation record.
 *
 * The browser tab, the install prompt and anything that shares a link all read
 * the SACCO's own name rather than a literal, so renaming the SACCO renames
 * these too.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
  title: {
    default: brand.shortName,
    template: `%s · ${brand.shortName}`,
  },
  description: `${brand.legalName} — savings, shares and loans for members.`,
  applicationName: brand.shortName,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: brand.shortName,
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  // The app is behind a login; there is nothing here for a crawler.
  robots: { index: false, follow: false },
  };
}

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();

  return (
    <html lang="en" className={`light ${inter.variable}`}>
      <head>
        {/* Before anything else: Chrome fires its install event earlier than
            React hydrates, and the member app prompt needs that event. */}
        <InstallEventCapture />
        {/* Subsetted icon font — see src/lib/icons.ts for why. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={MATERIAL_SYMBOLS_HREF} />
      </head>
      <body className={`${inter.className} bg-background text-on-background antialiased`}>
        <BrandProvider brand={brand}>{children}</BrandProvider>
        {/* Registered for everyone: a browser will not offer to install the app
            without it. It caches icons and nothing else. */}
        <ServiceWorker />
      </body>
    </html>
  );
}
