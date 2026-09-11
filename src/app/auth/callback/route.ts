import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RECOVERY_COOKIE, RECOVERY_MAX_AGE_SECONDS } from '@/lib/recovery';

/**
 * Exchanges the one-time code in a Supabase email link (password reset,
 * invitation) for a session cookie, then forwards to the real destination.
 *
 * A password-reset link also leaves a short-lived, httpOnly marker naming the
 * account. `/reset-password` sets a new password without asking for the
 * current one, so it must only work for a session that really came from the
 * emailed link - not for any signed-in phone left unlocked on a desk.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${safeNext}`);
      if (safeNext === '/reset-password' && data.user) {
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
