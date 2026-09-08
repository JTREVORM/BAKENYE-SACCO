'use client';

import { createContext, useContext } from 'react';
import { FALLBACK_BRAND, type Brand } from '@/lib/sacco-brand';

/**
 * The SACCO's own name, available to every client component.
 *
 * The name, short name and motto appear in the sidebar, the member drawer, the
 * desktop rail, the top bar, the sign-in screen and the footer of several
 * pages. Threading them as props through six shells and their twenty-odd call
 * sites would have meant touching every member page to change a string; a
 * context set once in the root layout reaches all of them.
 *
 * The value is read on the server — in the root layout, from
 * `sacco_public_brand()` — so there is no client fetch and no flash of a
 * placeholder name before the real one arrives.
 *
 * The type itself and `splitName` live in `lib/sacco-brand.ts`, because server
 * components need them too and a `'use client'` module cannot hand a plain
 * function to the server.
 */

const BrandContext = createContext<Brand>(FALLBACK_BRAND);

export function BrandProvider({
  brand,
  children,
}: {
  brand: Brand;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}
