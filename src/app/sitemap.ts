import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, absoluteUrl, isProductionSite } from '@/lib/site';

/**
 * /sitemap.xml
 *
 * Generated from `PUBLIC_PAGES`, which is the one list that decides what is
 * public. Nothing here is enumerated from the database: a sitemap built from
 * member or transaction rows would publish the existence of records that are
 * nobody's business, even if the pages themselves stayed behind the login.
 *
 * Empty off the production domain, so a preview deployment never offers Google
 * a map of itself.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isProductionSite()) return [];

  const lastModified = new Date();

  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
