/**
 * The SACCO's own identity, in a module neither side owns.
 *
 * The brand is needed by server components (the sign-in shell, the staff
 * dashboard hero, the top bar) and by client components (the sidebar, the
 * member drawer, the desktop rail). Neither of the obvious homes works for
 * both: `lib/brand.ts` imports the server Supabase client, so a client
 * component may not touch it, and `BrandProvider.tsx` is a `'use client'`
 * module, so a server component may not call a plain function out of it.
 *
 * So the shared type and the one shared helper live here, with no directive and
 * no imports, and both sides import from this.
 */

export type Brand = {
  legalName: string;
  shortName: string;
  motto: string;
  /** Null when the SACCO has not published one. Never a placeholder. */
  contactEmail: string | null;
  contactPhone: string | null;
};

/**
 * The seeded defaults.
 *
 * A fallback for the case where the settings row cannot be read at all — a
 * failed read must not leave the sign-in screen with no name on it. It is not a
 * second source of truth: the moment the row is readable, the row wins.
 */
export const FALLBACK_BRAND: Brand = {
  legalName: 'Bakenye Unity and Development SACCO',
  shortName: 'BUD-SACCO',
  motto: 'Together We Grow, Prosper and Build',
  contactEmail: null,
  contactPhone: null,
};

/**
 * The registered name split for a two-line lockup.
 *
 * The sidebar, the drawer, the desktop rail and the dashboard hero all set the
 * name over two lines, and each used to do it with a hard-coded `<br />` in the
 * middle of the words. This breaks at the word boundary nearest the middle of
 * the string, so a SACCO that renames itself does not end up with one line of
 * nine words and one of none.
 */
export function splitName(name: string): [string, string] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [name.trim(), ''];

  const midpoint = name.trim().length / 2;
  let best = 1;
  let bestDistance = Infinity;
  let length = 0;

  // Every legal break point is between two words; take the one whose left-hand
  // side comes closest to half the string.
  for (let i = 0; i < words.length - 1; i += 1) {
    length += words[i].length + (i > 0 ? 1 : 0);
    const distance = Math.abs(length - midpoint);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i + 1;
    }
  }

  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}
