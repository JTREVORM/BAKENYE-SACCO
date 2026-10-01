import type { MetadataRoute } from 'next';
import { getBrand } from '@/lib/brand';

/**
 * Installable web app.
 *
 * Most of the membership uses mid-to-low-end Android phones on limited data.
 * An installable PWA lets them add BUD-SACCO to the home screen and open it
 * like an app, without paying for a Play Store download or keeping a native
 * binary updated.
 *
 * The name comes from the organisation record, the same place the browser tab
 * and every printed heading read it from, so renaming the SACCO renames the
 * installed app too.
 *
 * Installability needs more than this file: a browser will only offer to
 * install a site that is served over HTTPS, has a manifest with a name, a
 * start URL, a standalone display mode and an icon of at least 192px, AND has
 * a registered service worker with a fetch handler. That worker is
 * `public/sw.js`, registered by `components/pwa/ServiceWorker.tsx`.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getBrand();

  return {
    name: brand.legalName,
    short_name: brand.shortName,
    description: `${brand.legalName} — savings, shares and loans for members.`,
    // The sign-in screen redirects an existing session onwards, so launching
    // the installed app lands a signed-in member on their dashboard and anyone
    // else on sign-in. No separate start route, and no redirect loop.
    start_url: '/',
    scope: '/',
    id: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9f9fc',
    theme_color: '#0a2148',
    lang: 'en',
    dir: 'ltr',
    categories: ['finance'],
    // `any` icons are drawn as they are; the `maskable` one is the same mark
    // inset on the brand navy, so a launcher that crops to a circle or a
    // squircle cuts padding rather than the logo.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My savings', url: '/savings' },
      { name: 'My loans', url: '/loans' },
      { name: 'Statements', url: '/statements' },
    ],
  };
}
