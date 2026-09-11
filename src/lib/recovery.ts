/**
 * The marker `/auth/callback` leaves when a password-reset link is opened.
 * `resetPassword()` accepts a new password without the current one only while
 * this names the signed-in account, and removes it once used.
 */
export const RECOVERY_COOKIE = 'bnd_pw_recovery';

/** How long a reset link, once opened, stays usable. */
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;
