import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { IDLE_LIMIT_COOKIE, LAST_SEEN_COOKIE, idleMinutes, sessionCookieOptions } from '@/lib/session-timeout';
import { buildCsp, cspHeaderName, cspMode, newNonce } from '@/lib/csp';
import {
  MAINTENANCE_BYPASS_COOKIE,
  isMaintenanceExempt,
  maintenanceGateDecision,
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ---- Maintenance mode -----------------------------------------------------
  //
  // Before anything else, and deliberately before the Supabase client is built:
  // maintenance is most useful while the database is being worked on, so the
  // page must not depend on it. See lib/maintenance.ts.
  const gate = maintenanceGateDecision();
  if (gate.refusalReason) {
    // Loud, and on every request, because a silent one would be missed by the
    // person who most needs to see it (F-10).
    console.error(`[maintenance] ${gate.refusalReason}`);
  }
  if (gate.engage && !isMaintenanceExempt(pathname)) {
    const carried = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value;
    const maintainer = !!gate.bypassToken && !!carried && safeEqual(carried, gate.bypassToken);
    if (!maintainer) {
      return new NextResponse(maintenanceHtml(), {
        status: 503,
        headers: maintenanceHeaders(),
      });
    }
  }

  // ---- Content-Security-Policy ---------------------------------------------
  //
  // Built here because a nonce has to be minted per request, and set on the
  // request as well as the response so Next can stamp it onto its own inline
  // scripts. Report-only unless CSP_MODE says otherwise. See lib/csp.ts.
  const mode = cspMode();
  const nonce = mode === 'off' ? null : newNonce();
  const csp = nonce ? buildCsp(nonce) : null;
  if (csp) {
    // The enforcing name, on the request, is where Next looks for the nonce -
    // whichever name the browser is eventually sent.
    request.headers.set('content-security-policy', csp);
    request.headers.set('x-nonce', nonce!);
  }

  let response = NextResponse.next({ request });

  const applyCsp = (res: NextResponse): NextResponse => {
    const header = cspHeaderName(mode);
    if (csp && header) res.headers.set(header, csp);
    return res;
  };

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
          response = applyCsp(NextResponse.next({ request }));
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

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return applyCsp(NextResponse.redirect(url));
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
      const redirect = applyCsp(NextResponse.redirect(url));
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

  return applyCsp(response);
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
