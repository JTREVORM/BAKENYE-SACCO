import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
     */
    '/((?!_next/static|_next/image|favicon.ico|brand|avatars|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
