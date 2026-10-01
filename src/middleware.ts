import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { IDLE_LIMIT_COOKIE, LAST_SEEN_COOKIE, idleMinutes, sessionCookieOptions } from '@/lib/session-timeout';

/**
 * Refreshes the Supabase session cookie on every navigation and keeps
 * unauthenticated users out of the app shell.
 *
 * The real authorisation happens in `requirePermission()` and in RLS. This is
 * the cheap first gate: it stops a signed-out phone from downloading a page
 * shell it will only be redirected away from.
 */
const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/help',
  // The design QA harness. The route itself returns a 404 when
  // NODE_ENV is production, so this only ever opens it locally.
  ...(process.env.NODE_ENV === 'production' ? [] : ['/dev']),
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Idle sign-out: a session untouched for longer than the SACCO's timeout is
  // ended here, on its next request. See lib/session-timeout.ts.
  if (user) {
    const limit = idleMinutes(request.cookies.get(IDLE_LIMIT_COOKIE)?.value);
    const lastSeen = Number(request.cookies.get(LAST_SEEN_COOKIE)?.value);
    const now = Date.now();
    if (limit > 0 && Number.isFinite(lastSeen) && lastSeen > 0 && now - lastSeen > limit * 60_000) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      url.searchParams.set('reason', 'timeout');
      if (!isPublic) url.searchParams.set('next', pathname);
      const redirect = NextResponse.redirect(url);
      // Carry the cleared Supabase session cookies onto the redirect.
      for (const c of response.cookies.getAll()) redirect.cookies.set(c);
      redirect.cookies.delete(LAST_SEEN_COOKIE);
      return redirect;
    }
    response.cookies.set(LAST_SEEN_COOKIE, String(now), sessionCookieOptions);
  }

  // A signed-in visitor to /login is sent on by the page itself, which knows
  // whether the account is still in good standing; redirecting here could
  // bounce a suspended account between /login and the dashboard forever.

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and images - those must not pay for an
     * auth round trip on a slow connection.
     *
     * `sw.js` and the manifest are listed because a browser fetches them before
     * anyone has signed in. Sending either to /login would stop the app ever
     * being installable.
     */
    '/((?!_next/static|_next/image|favicon.ico|brand|avatars|icons|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
