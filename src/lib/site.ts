/**
 * Where this deployment lives, and what a crawler may do with it.
 *
 * Two things were spread across the codebase before this module existed: the
 * site's own URL (hard-coded as `http://localhost:3000` in one password-reset
 * path, absent everywhere else, so no page could state a canonical address) and
 * the decision about indexing (one blanket `robots: { index: false }` in the
 * root layout). Both now live here.
 *
 * The important rule this file encodes: **this is a SACCO management system, and
 * almost all of it is private.** Member savings, shares, loans, receipts,
 * statements, reports and every staff screen must stay out of Google entirely.
 * Only the handful of pages listed in `PUBLIC_PAGES` are offered for indexing,
 * and only when the site is actually being served from the SACCO's own domain -
 * a preview build must never compete with production in search results.
 *
 * None of this is a security boundary. Authentication and RLS are. A crawler
 * directive is a request; a sign-in is a wall. See `src/middleware.ts` and the
 * `requirePermission()` helpers for the wall.
 */
import type { Metadata } from 'next';

/** The domain the SACCO owns. */
export const PRODUCTION_URL = 'https://bakenye-sacco.online';

/**
 * The base URL for this environment, with no trailing slash.
 *
 * In order:
 *
 *  1. `NEXT_PUBLIC_SITE_URL`, the one value an operator can point at a custom
 *     domain.
 *  2. The SACCO's own domain, whenever the host says this is the production
 *     deployment. This comes **before** `VERCEL_URL` deliberately: Vercel sets
 *     `VERCEL_URL` on production deployments too, to the generated
 *     `*.vercel.app` hostname, and letting that win would make the live site
 *     believe it was a preview - which would publish an empty sitemap and a
 *     robots.txt blocking everything.
 *  3. `VERCEL_URL`, which is then genuinely a preview deployment.
 *  4. The production domain, for any other production build.
 *  5. localhost, in development.
 *
 * A staging deployment that forgets the variable therefore describes itself
 * honestly instead of claiming to be production.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return stripSlash(configured);

  const hostEnv = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (hostEnv === 'production') return PRODUCTION_URL;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return stripSlash(vercel.startsWith('http') ? vercel : `https://${vercel}`);

  if (process.env.NODE_ENV === 'production') return PRODUCTION_URL;
  return 'http://localhost:3000';
}

/** An absolute URL for `path`, for canonical tags, sitemaps and e-mail links. */
export function absoluteUrl(path = '/'): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** True only on the SACCO's own production domain. */
export function isProductionSite(): boolean {
  return siteUrl() === PRODUCTION_URL;
}

/**
 * The Google Search Console verification token.
 *
 * Supplied through the environment so that no token - real or invented - is
 * committed. Absent, the meta tag is simply not rendered; Search Console then
 * falls back to its DNS or file methods.
 */
export function googleSiteVerification(): string | undefined {
  const token = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  return token ? token : undefined;
}

/**
 * The default for everything: keep out.
 *
 * `nocache` is included because Google's cached copy of a member's dashboard
 * would be a data leak even after the page itself stopped being reachable.
 */
export const PRIVATE_ROBOTS: Metadata['robots'] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

/**
 * The exception, granted page by page - and only on the real domain. Anywhere
 * else this is identical to `PRIVATE_ROBOTS`, which is what stops preview
 * deployments from being indexed as duplicates of the public site.
 */
export const PUBLIC_ROBOTS: Metadata['robots'] = isProductionSite()
  ? {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    }
  : PRIVATE_ROBOTS;

/**
 * Every page offered to search engines. The sitemap is generated from this, so
 * adding a public page here is the single step that publishes it.
 *
 * `/` is the public landing page for a visitor with no session; a signed-in
 * member sees their dashboard at the same address (see `src/middleware.ts`).
 * A crawler is never signed in, so what Google fetches from `/` is the landing
 * page and nothing else.
 */
export const PUBLIC_PAGES: {
  path: string;
  changeFrequency: 'yearly' | 'monthly' | 'weekly';
  priority: number;
}[] = [
  { path: '/', changeFrequency: 'monthly', priority: 1 },
  { path: '/help', changeFrequency: 'yearly', priority: 0.5 },
];

/**
 * What `robots.txt` asks crawlers to stay out of.
 *
 * This is courtesy, not protection - every one of these paths already requires a
 * session, and the ones that serve data require a permission on top. It is here
 * so that a well-behaved crawler does not spend its budget on a wall of
 * redirects to /login, and so that nothing from the management system can turn
 * up in a search result through a link someone pasted in public.
 */
export const CRAWLER_DISALLOW = [
  '/staff/',
  '/member/',
  '/savings',
  '/shares',
  '/loans',
  '/guarantees',
  '/transactions',
  '/statements',
  '/reports',
  '/notifications',
  '/profile',
  '/more',
  '/no-member-record',
  '/admin/',
  '/api/',
  '/auth/',
  '/login',
  '/change-password',
  '/forgot-password',
  '/reset-password',
  '/maintenance-bypass',
  '/dev/',
];
