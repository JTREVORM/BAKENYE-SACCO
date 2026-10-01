import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { IDLE_LIMIT_COOKIE, LAST_SEEN_COOKIE } from '@/lib/session-timeout';
import { INSTALL_PROMPT_COOKIE } from '@/lib/pwa';

/**
 * Sign out.
 *
 * A route handler rather than a server action, so the browser makes a full
 * navigation to /login. That throws away the client-side cache of the pages
 * just left, and those pages are served `no-store`, so pressing Back does not
 * put a signed-in screen back on a shared phone.
 *
 * POST only: a link or an image tag must not be able to sign somebody out.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.rpc('log_logout');
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const res = NextResponse.redirect(url, { status: 303 });
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Clear-Site-Data', '"cache"');
  res.cookies.delete(LAST_SEEN_COOKIE);
  res.cookies.delete(IDLE_LIMIT_COOKIE);
  // Nothing of this sign-in survives, including an install offer that was armed
  // but never shown. The next sign-in arms it again.
  res.cookies.delete(INSTALL_PROMPT_COOKIE);
  return res;
}
