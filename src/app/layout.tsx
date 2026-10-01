import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { MATERIAL_SYMBOLS_HREF } from '@/lib/icons';
import { BrandProvider } from '@/components/brand/BrandProvider';
import { InstallEventCapture } from '@/components/pwa/InstallEventCapture';
import { ServiceWorker } from '@/components/pwa/ServiceWorker';
import { getBrand } from '@/lib/brand';
import { PRIVATE_ROBOTS, googleSiteVerification, siteUrl } from '@/lib/site';
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
  const description = `${brand.legalName} — savings, shares and loans for members.`;

  return {
    // Every relative URL in this object - canonicals, Open Graph images, the
    // sitemap reference - is resolved against this. Without it Next.js warns and
    // emits relative og:image URLs, which no social crawler can fetch.
    metadataBase: new URL(siteUrl()),
    title: {
      default: brand.shortName,
      template: `%s · ${brand.shortName}`,
    },
    description,
    applicationName: brand.shortName,
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
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
    // Google Search Console. Rendered only when the token is configured, so no
    // placeholder verification tag is ever served. See lib/site.ts.
    verification: { google: googleSiteVerification() },
    /**
     * Noindex is the default for the whole application, and the public pages
     * opt back in individually (see lib/site.ts and app/welcome/page.tsx).
     * Doing it this way round means a new screen is private unless somebody
     * deliberately publishes it - a member's statement cannot reach Google
     * because its author forgot a line.
     */
    robots: PRIVATE_ROBOTS,
    /**
     * Shared-link previews. The name and strapline only; nothing here depends
     * on who is signed in, so a link pasted into WhatsApp shows the SACCO
     * rather than a fragment of somebody's dashboard.
     */
    openGraph: {
      type: 'website',
      siteName: brand.legalName,
      title: brand.shortName,
      description,
      locale: 'en_UG',
      url: '/',
      images: [
        {
          url: '/brand/og-image.png',
          width: 1200,
          height: 630,
          alt: `${brand.legalName} — ${brand.motto}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: brand.shortName,
      description,
      images: ['/brand/og-image.png'],
    },
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
