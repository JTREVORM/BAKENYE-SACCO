import { Caveat } from 'next/font/google';

/**
 * The handwritten motto on the sign-in screen.
 *
 * One family, one weight, latin only, self-hosted by `next/font` exactly as
 * Inter is — so it costs a single ~15 KB woff2 from our own origin rather than
 * a render-blocking round trip to Google, and it is only preloaded on the
 * routes that actually use it.
 *
 * It is deliberately confined to "Stronger Members, Brighter Futures". A
 * script face is a signature, not a typeface for reading; nothing else in the
 * application uses it.
 */
export const brandScript = Caveat({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
  fallback: ['Segoe Script', 'Bradley Hand', 'cursive'],
});
