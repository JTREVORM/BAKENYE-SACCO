import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { IDLE_LIMIT_COOKIE, LAST_SEEN_COOKIE, idleMinutes, sessionCookieOptions } from '@/lib/session-timeout';
import {
  MAINTENANCE_BYPASS_COOKIE,
  isMaintenanceEnabled,
  isMaintenanceExempt,
  maintenanceBypassToken,
  maintenanceHeaders,
  maintenanceHtml,
  safeEqual,
} from '@/lib/maintenance';

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
  // The public landing page. `/` is rewritten here for a visitor with no
  // session; it is also reachable directly, and says so with a canonical tag
  // pointing back at `/`.
  '/welcome',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/help',
  // Exchanges the maintainer's token for a cookie; it reveals nothing and the
  // application behind it still demands a real sign-in.
  '/maintenance-bypass',
  // The design QA harness. The route itself returns a 404 when
  // NODE_ENV is production, so this only ever opens it locally.
  ...(process.env.NODE_ENV === 'production' ? [] : ['/dev']),
];

/**
 * The only paths a search engine may index.
 *
 * Everything else leaves here carrying `X-Robots-Tag: noindex, nofollow`. The
 * page metadata says the same thing (see lib/site.ts), and this is the second
 * belt: a header covers a response that is not an HTML document at all, and it
 * cannot be forgotten by the author of a new screen - a page is private here
 * until it is listed above.
 *
 * `/login` is deliberately absent. It is public, but a sign-in form is not what
 * the SACCO wants someone to find when they search for it.
 */
const INDEXABLE_PATHS = new Set(['/', '/welcome', '/help']);

/**
 * Stamps `X-Robots-Tag: noindex` on anything that is not one of those - the
 * redirect to /login included, because a 302 is itself a crawlable URL and
 * Google will happily list `/staff/members` on the strength of one.
 */
function withRobotsTag(response: NextResponse, pathname: string): NextResponse {
  if (!INDEXABLE_PATHS.has(pathname)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ---- Maintenance mode -----------------------------------------------------
  //
  // Before anything else, and deliberately before the Supabase client is built:
  // maintenance is most useful while the database is being worked on, so the
  // page must not depend on it. See lib/maintenance.ts.
  if (isMaintenanceEnabled() && !isMaintenanceExempt(pathname)) {
    const token = maintenanceBypassToken();
    const carried = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value;
    const maintainer = !!token && !!carried && safeEqual(carried, token);
    if (!maintainer) {
      return new NextResponse(maintenanceHtml(), {
        status: 503,
        headers: maintenanceHeaders(),
      });
    }
  }

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

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // ---- The public front door ----------------------------------------------
  //
  // `/` serves two different pages. A signed-in member gets their dashboard; a
  // visitor with no session gets the public landing page, rewritten rather than
  // redirected so that the SACCO's bare domain is the address Google indexes and
  // ranks. Redirecting to /login instead - which is what this used to do - left
  // the SACCO with no indexable homepage at all.
  if (!user && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/welcome';
    const rewrite = NextResponse.rewrite(url, { request });
    for (const c of response.cookies.getAll()) rewrite.cookies.set(c);
    return rewrite;
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return withRobotsTag(NextResponse.redirect(url), pathname);
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
      return withRobotsTag(redirect, pathname);
    }
    response.cookies.set(LAST_SEEN_COOKIE, String(now), sessionCookieOptions);
  }

  // A signed-in visitor to /login is sent on by the page itself, which knows
  // whether the account is still in good standing; redirecting here could
  // bounce a suspended account between /login and the dashboard forever.

  return withRobotsTag(response, pathname);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and images - those must not pay for an
     * auth round trip on a slow connection.
     *
     * `sw.js` and the manifest are listed because a browser fetches them before
     * anyone has signed in. Sending either to /login would stop the app ever
     * being installable - and for the same reason `robots.txt` and `sitemap.xml`
     * are listed too: a crawler is never signed in, and a 302 to /login would
     * hide both files from Google.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|brand|avatars|icons|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
