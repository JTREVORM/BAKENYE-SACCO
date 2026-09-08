import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { FALLBACK_BRAND, type Brand } from '@/lib/sacco-brand';

/**
 * The SACCO's public branding, read on the server.
 *
 * Called from the root layout, which renders for signed-out visitors as well as
 * members, so it goes through `sacco_public_brand()` rather than reading
 * `sacco_settings` directly — that function returns only the three fields that
 * are public anyway and is granted to `anon`.
 *
 * The fallback is the text the database is seeded with. It exists so that a
 * failed read leaves the sign-in screen with a name on it rather than a blank
 * space; it is not a second place to change the name.
 */
export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc('sacco_public_brand');
    const row = data as {
      legal_name?: string;
      short_name?: string;
      motto?: string;
      contact_email?: string | null;
      contact_phone?: string | null;
    } | null;

    if (row?.legal_name && row.short_name) {
      return {
        legalName: row.legal_name,
        shortName: row.short_name,
        motto: row.motto ?? '',
        contactEmail: row.contact_email ?? null,
        contactPhone: row.contact_phone ?? null,
      };
    }
  } catch {
    // Falls through to the seeded defaults below. A settings read that fails
    // must not be the reason the application will not render at all.
  }

  return FALLBACK_BRAND;
});
