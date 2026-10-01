import type { MetadataRoute } from 'next';
import { CRAWLER_DISALLOW, absoluteUrl, isProductionSite } from '@/lib/site';

/**
 * /robots.txt
 *
 * Two different files, depending on where this is deployed.
 *
 * On the SACCO's own domain: the public pages are open, and the management
 * system - every member and staff route - is asked to be left alone. On a
 * preview or staging deployment: nothing is crawlable at all, because a preview
 * URL in Google's index competes with the real site for the SACCO's own name.
 *
 * This file is a request to well-behaved crawlers and nothing more. The reason
 * member savings and staff screens are safe is that they require a session and,
 * beyond that, a permission; a disallow line is only there so a crawler does
 * not waste its budget on a wall of redirects to /login.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: CRAWLER_DISALLOW,
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
