/**
 * Idle sign-out (Settings -> Security -> "Session timeout").
 *
 * At sign-in the SACCO's configured timeout is written to an httpOnly cookie,
 * and the middleware stamps the time of every request. A session left idle
 * longer than the timeout is signed out on its next request - so a phone left
 * unlocked on a counter does not stay in someone's account all day.
 *
 * The timeout travels in a cookie rather than being read from the database on
 * every request because the middleware runs on every navigation, on 3G.
 */
export const IDLE_LIMIT_COOKIE = 'bnd_idle_min';
export const LAST_SEEN_COOKIE = 'bnd_last_seen';

/** Used when a session predates the cookie, or the setting failed to load. */
export const DEFAULT_IDLE_MINUTES = 60;

/** A sane range: 0 or less switches the timeout off; the cap is a day. */
export function idleMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_IDLE_MINUTES;
  return Math.min(Math.round(n), 24 * 60);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  // Outlives the idle window comfortably; the stamp inside is what counts.
  maxAge: 7 * 24 * 60 * 60,
};
