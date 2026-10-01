import { NextResponse, type NextRequest } from 'next/server';
import {
  MAINTENANCE_BYPASS_COOKIE,
  isMaintenanceEnabled,
  maintenanceBypassToken,
  safeEqual,
} from '@/lib/maintenance';

/**
 * Let a maintainer past the maintenance page.
 *
 *   /maintenance-bypass?token=<MAINTENANCE_BYPASS_TOKEN>
 *
 * The token is exchanged once for an httpOnly cookie and the visitor is sent to
 * the sign-in screen; from then on the browser carries the cookie and the
 * middleware lets it through.
 *
 * WHAT THIS DOES AND DOES NOT GRANT
 *
 * It grants sight of the application's sign-in screen. It is not a login and it
 * is not a permission: everything beyond it still demands a real Supabase
 * session, and every row is still behind RLS. So even a token that leaked - and
 * a token in a URL does end up in history and logs - gets somebody no further
 * than any member of the public could already get before maintenance started.
 * That is what makes a query-string exchange acceptable here rather than weak
 * security; rotate `MAINTENANCE_BYPASS_TOKEN` if you would rather it did not
 * linger in a browser's history.
 *
 * With `MAINTENANCE_BYPASS_TOKEN` unset there is no bypass at all: this route
 * refuses everybody, which is the safe default.
 */
export async function GET(request: NextRequest) {
  const home = new URL('/', request.url);

  // Outside maintenance there is nothing to bypass; do not mint a cookie that
  // would silently outlive the next maintenance window.
  if (!isMaintenanceEnabled()) return NextResponse.redirect(home);

  const expected = maintenanceBypassToken();
  const offered = request.nextUrl.searchParams.get('token') ?? '';

  if (!expected || !safeEqual(offered, expected)) {
    // Say nothing about which part was wrong, and nothing about whether a
    // bypass exists at all.
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  const response = NextResponse.redirect(new URL('/login', request.url));
  response.cookies.set(MAINTENANCE_BYPASS_COOKIE, expected, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    // Long enough for a maintenance window, short enough to expire on its own.
    maxAge: 12 * 60 * 60,
  });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}
