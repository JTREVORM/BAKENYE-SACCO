import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  RECOVERY_COOKIE,
  RECOVERY_MAX_AGE_SECONDS,
  SELF_SERVICE_RECOVERY_ENABLED,
} from '@/lib/recovery';
import { IDLE_LIMIT_COOKIE, LAST_SEEN_COOKIE, sessionCookieOptions } from '@/lib/session-timeout';
import { getRules } from '@/lib/settings';

/**
 * Exchanges the one-time code in a Supabase email link (password reset,
 * invitation) for a session cookie, then forwards to the real destination.
 *
 * A password-reset link also leaves a short-lived, httpOnly marker naming the
 * account. `/reset-password` sets a new password without asking for the
 * current one, so it must only work for a session that really came from the
 * emailed link - not for any signed-in phone left unlocked on a desk.
 *
 * WHILE SELF-SERVICE RECOVERY IS SUSPENDED (see lib/recovery.ts) this route is
 * the third door that has to stay shut, after the forgot-password action and
 * `resetPassword()`. A recovery link emailed before the suspension - or a
 * crafted callback URL carrying such a code - must not be exchangeable, so the
 * code is not spent at all: no session is created, and the visitor is sent to
 * the page that tells them to contact the SACCO. Callbacks that are not
 * recovery still work, because breaking those would break account invitations.
 *
 * Every session this route opens starts the idle clock with the SACCO's own
 * configured timeout (F-08). Before, it set neither cookie, so a session born
 * here was governed by a hardcoded 60 minutes and skipped the idle check on
 * its first request regardless of what the SACCO had configured.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const isRecovery = safeNext === '/reset-password';

  if (isRecovery && !SELF_SERVICE_RECOVERY_ENABLED) {
    // Deliberately before the exchange: an unspent code stays unspent, and no
    // session - recovery or otherwise - is ever created from it.
    return NextResponse.redirect(`${origin}/forgot-password?reason=unavailable`);
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${safeNext}`);

      // The SACCO's configured idle timeout, not a hardcoded fallback, and a
      // first stamp so the very next request is already inside the window.
      const rules = await getRules();
      response.cookies.set(
        IDLE_LIMIT_COOKIE,
        String(Math.round(rules.sessionTimeoutMinutes)),
        sessionCookieOptions,
      );
      response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), sessionCookieOptions);

      if (isRecovery && data.user) {
        response.cookies.set(RECOVERY_COOKIE, data.user.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: RECOVERY_MAX_AGE_SECONDS,
        });
      }
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link_expired`);
}
