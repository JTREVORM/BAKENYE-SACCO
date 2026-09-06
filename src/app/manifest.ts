import type { MetadataRoute } from 'next';

/**
 * Installable web app.
 *
 * Most of the membership uses mid-to-low-end Android phones on limited data.
 * An installable PWA lets them add BND-SACCO to the home screen and open it
 * like an app, without paying for a Play Store download or keeping a native
 * binary updated.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bakenye National Development SACCO',
    short_name: 'BND-SACCO',
    description: 'Savings, shares and loans for members of BND-SACCO.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9f9fc',
    theme_color: '#0e3483',
    lang: 'en',
    categories: ['finance'],
    icons: [
      { src: '/brand/bnd-logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/bnd-logo.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
