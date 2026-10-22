/**
 * Password recovery policy.
 *
 * SELF-SERVICE RECOVERY IS SUSPENDED
 *
 * A SACCO business decision, taken alongside the 22 October 2026 diagnostic:
 * nobody - member or staff - recovers a forgotten password by themselves. A
 * forgotten password is handled in person, by an officer who can identify the
 * holder, through the staff-assisted reset in `resetUserPassword()`.
 *
 * The switch below is the single place that decides it. Everything that could
 * start, deliver or finish a self-service recovery reads it:
 *
 *   requestPasswordReset()    the public "forgot password" action
 *   resetPassword()           setting a password from an emailed link
 *   /auth/callback            exchanging an emailed link for a session
 *
 * Each of those refuses on its own, rather than relying on the screen in front
 * of it, so a direct POST to the server action, a saved link, or a crafted
 * callback URL all reach the same closed door. There is deliberately no second
 * public route that does any of this.
 *
 * WHY THE FLOW IS REMOVED RATHER THAN HIDDEN
 *
 * F-03 of the diagnostic: the reset-redirect host was built from the request's
 * `Origin` header whenever `NEXT_PUBLIC_SITE_URL` was unset, which it is in
 * production. An attacker could therefore have Supabase email a victim a
 * genuine reset link pointing at the attacker's host. Suspending the flow
 * removes the only code path that read that header, so the defect has no
 * remaining route to production - it is not merely unreachable from the UI.
 *
 * WHAT MUST BE TRUE BEFORE THIS IS TURNED BACK ON
 *
 * All five, verified, before `SELF_SERVICE_RECOVERY_ENABLED` is set true:
 *
 *  1. `NEXT_PUBLIC_SITE_URL=https://www.bakenye-sacco.online` is set on the
 *     production target and the build that carries it has been promoted. It is
 *     inlined at build time, so setting it is not enough on its own.
 *  2. `siteUrl()` below is the only source of the redirect host, and it throws
 *     in production rather than falling back to a request header or localhost.
 *  3. The Supabase project's Redirect URL allow-list contains
 *     `https://www.bakenye-sacco.online/**` and nothing else - no `**`, no
 *     `http://localhost:3000/**`.
 *  4. Supabase Auth rate limiting for recovery emails is configured, and the
 *     SACCO has decided how an account with no real email address recovers
 *     (most members have none; for them this flow never applied).
 *  5. A regression test asserts that the redirect host ignores the `Origin`
 *     header, and the suspended-flow tests below are inverted to cover the
 *     re-enabled behaviour.
 *
 * Re-enabling is a separate, reviewed change. It is explicitly out of scope of
 * the backend remediation this file is part of.
 */
export const SELF_SERVICE_RECOVERY_ENABLED = false;

/**
 * The one sentence every suspended-recovery path returns, whatever was asked
 * and whether or not the identifier names a real account. It reveals nothing:
 * the answer is identical for a member number that exists, one that does not,
 * and a malformed one.
 */
export const RECOVERY_SUSPENDED_MESSAGE =
  'Self-service password recovery is temporarily unavailable. Please contact SACCO Support or visit the SACCO office for assistance.';

/**
 * The marker `/auth/callback` leaves when a password-reset link is opened.
 * `resetPassword()` accepts a new password without the current one only while
 * this names the signed-in account, and removes it once used.
 *
 * Unused while recovery is suspended - no path sets it - and kept so that the
 * re-enabling change is a switch rather than a rebuild.
 */
export const RECOVERY_COOKIE = 'bnd_pw_recovery';

/** How long a reset link, once opened, stays usable. */
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;

/**
 * The host this deployment is reached at, for links that must survive leaving
 * the application - an emailed one, above all.
 *
 * Never derived from a request header: a header is the client's to set, and a
 * link built from one can point anywhere (F-03). In production the variable is
 * required; a deployment that forgot it should fail loudly rather than mint
 * links to localhost or to whoever asked.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL must be set in production; refusing to guess a link host.');
  }
  return 'http://localhost:3000';
}
