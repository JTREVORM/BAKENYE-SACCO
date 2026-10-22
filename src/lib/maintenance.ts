/**
 * Maintenance mode.
 *
 * A switch that puts a professional "system under maintenance" page in front of
 * every visitor, so the SACCO can be worked on without anybody landing in a
 * half-updated system.
 *
 * HOW IT IS BUILT, AND WHY
 *
 * The gate lives at the very top of the middleware, before the Supabase client
 * is even constructed. That ordering is the point: maintenance is most useful
 * exactly when the database is being worked on, so the page must not depend on
 * the database, on authentication, or on the application rendering at all.
 *
 * The response is served straight from the middleware as a complete HTML
 * document rather than by rewriting to a page, because:
 *
 *   * a rewrite can only answer 200, and the honest answer to "is this site
 *     available?" during maintenance is 503 - that is what tells Google to come
 *     back later instead of dropping the pages it already knows;
 *   * there is no second route to redirect to, so there is no redirect loop to
 *     get wrong;
 *   * it keeps working even when the app itself cannot render.
 *
 * Static assets are already outside the middleware's matcher, so icons, the
 * manifest, the service worker and images keep being served normally and the
 * page can show the SACCO's own logo.
 *
 * NOTHING HERE TOUCHES DATA. No query, no session, no write.
 */

/** The cookie a maintainer carries once they have used the bypass link. */
export const MAINTENANCE_BYPASS_COOKIE = 'bnd_maintenance_bypass';

/** Where a maintainer exchanges the token for that cookie. */
export const MAINTENANCE_BYPASS_PATH = '/maintenance-bypass';

/**
 * Is maintenance mode on?
 *
 * Driven by `MAINTENANCE_MODE`, a server-side variable - not `NEXT_PUBLIC_` -
 * so the switch is never shipped to the browser and cannot be read or flipped
 * from the client.
 */
export function isMaintenanceEnabled(): boolean {
  const raw = (process.env.MAINTENANCE_MODE ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

/**
 * The maintainer's bypass token, or null when no bypass exists.
 *
 * Anything under 16 characters is treated as absent rather than accepted, so a
 * placeholder left in an environment variable is never a usable token. There is
 * deliberately no default: a default bypass token is a published one.
 */
export function maintenanceBypassToken(): string | null {
  const token = (process.env.MAINTENANCE_BYPASS_TOKEN ?? '').trim();
  return token.length >= 16 ? token : null;
}

/**
 * Has somebody deliberately asked for a maintenance window with no way in?
 *
 * The original design allowed it, and it is occasionally what you want - a
 * window where nobody, maintainer included, should reach the application. But
 * it is also what you get by *forgetting* the token, and those two must not
 * look the same. This makes the deliberate version say so out loud.
 */
export function totalLockoutRequested(): boolean {
  const raw = (process.env.MAINTENANCE_ALLOW_TOTAL_LOCKOUT ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

/**
 * Should the maintenance gate actually close?
 *
 * F-10. `MAINTENANCE_MODE` was configured; `MAINTENANCE_BYPASS_TOKEN` was not.
 * In that state switching maintenance on returned 503 to *everybody* - SACCO
 * staff and whoever was performing the maintenance included - and the only way
 * back was to edit an environment variable and redeploy, which is precisely
 * what you least want to be doing in the middle of a maintenance window. The
 * tool existed to make database work safe and using it was a self-inflicted
 * outage.
 *
 * So the gate now refuses to close unless there is a way back through it:
 *
 *   token set                      maintenance engages, maintainer can get in
 *   no token, lockout requested    maintenance engages, nobody gets in - which
 *                                  is what was explicitly asked for
 *   no token, nothing requested    maintenance does NOT engage, and the reason
 *                                  is logged loudly
 *
 * The last case fails towards "the site stays up", which is the recoverable
 * direction: the operator sees the site still serving, reads the log, sets a
 * token and tries again - seconds, not a redeploy under pressure. Failing the
 * other way would mean the one mistake nobody can undo quickly.
 *
 * It does not make maintenance mode weaker. Nothing past the gate is reachable
 * without a real Supabase session and RLS still decides every row, so the gate
 * is a courtesy page, not an access control.
 */
export function maintenanceGateDecision(): {
  engage: boolean;
  bypassToken: string | null;
  refusalReason: string | null;
} {
  if (!isMaintenanceEnabled()) {
    return { engage: false, bypassToken: null, refusalReason: null };
  }

  const bypassToken = maintenanceBypassToken();
  if (bypassToken) return { engage: true, bypassToken, refusalReason: null };

  if (totalLockoutRequested()) {
    return { engage: true, bypassToken: null, refusalReason: null };
  }

  return {
    engage: false,
    bypassToken: null,
    refusalReason:
      'MAINTENANCE_MODE is on but MAINTENANCE_BYPASS_TOKEN is not set (it must be at least 16 characters), ' +
      'so engaging maintenance would lock out the SACCO and whoever is performing the maintenance. ' +
      'The gate has been left open. Set a strong MAINTENANCE_BYPASS_TOKEN and redeploy, or set ' +
      'MAINTENANCE_ALLOW_TOTAL_LOCKOUT=true if a window with no way in is genuinely intended. ' +
      'See docs/remediation/release-runbook.md.',
  };
}

/**
 * Compare without leaking where two strings first differ.
 *
 * `node:crypto` is not available in the Edge runtime the middleware uses, so
 * this is the same idea by hand: always walk the whole of the longer string.
 */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Paths that must answer normally even while maintenance mode is on. */
export function isMaintenanceExempt(pathname: string): boolean {
  // The bypass exchange itself, or a maintainer could never get in.
  if (pathname === MAINTENANCE_BYPASS_PATH) return true;
  // Belt and braces: the matcher already excludes these, but naming them here
  // means the gate stays correct even if the matcher is edited later.
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/brand/') ||
    pathname.startsWith('/avatars/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js'
  );
}

/**
 * The page itself.
 *
 * A self-contained document: no stylesheet, no script, no font request, so it
 * renders instantly and identically whatever state the rest of the system is
 * in. The colours are the SACCO's own - the navy of the brand and the app's
 * background - and the type stack is the same fallback the application declares
 * behind Inter, so it reads as the same product.
 */
export function maintenanceHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0a2148">
<title>System Under Maintenance · BAKENYE Unity and Development SACCO</title>
<link rel="icon" href="/icons/icon-192.png">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100svh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #f9f9fc;
    color: #1b1c20;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%;
    max-width: 620px;
    background: #ffffff;
    border-radius: 24px;
    padding: 40px 28px 32px;
    text-align: center;
    box-shadow: 0 1px 2px rgba(10, 33, 72, .06), 0 12px 32px rgba(10, 33, 72, .10);
  }
  .logo {
    width: 76px; height: 76px;
    object-fit: contain;
    margin: 0 auto 20px;
    display: block;
  }
  .org {
    margin: 0 0 24px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #0a2148;
  }
  h1 {
    margin: 0 0 16px;
    font-size: 26px;
    line-height: 1.25;
    font-weight: 700;
    color: #0a2148;
    text-wrap: balance;
  }
  p { margin: 0 0 14px; font-size: 16px; color: #43464f; }
  p:last-of-type { margin-bottom: 0; }
  .rule { height: 1px; background: #e4e5ec; margin: 28px 0 20px; border: 0; }
  footer { font-size: 12px; color: #70737d; }
  footer .name { text-wrap: balance; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #0a2148; display: block; margin-bottom: 4px; }
  footer .values { letter-spacing: .04em; }
  @media (min-width: 640px) {
    .card { padding: 48px 48px 36px; }
    h1 { font-size: 30px; }
  }
  @media (prefers-color-scheme: dark) {
    body { background: #101218; color: #e6e7ec; }
    .card { background: #181b23; box-shadow: 0 12px 32px rgba(0, 0, 0, .45); }
    h1, .org, footer .name { color: #b9c9ef; }
    p { color: #c3c6d0; }
    .rule { background: #2a2e39; }
    footer { color: #8e919b; }
  }
</style>
</head>
<body>
  <main class="card">
    <img class="logo" src="/icons/icon-192.png" alt="BAKENYE Unity and Development SACCO logo">
    <p class="org">BAKENYE Unity and Development SACCO</p>
    <h1>System Under Maintenance</h1>
    <p>We are currently performing scheduled improvements to the BAKENYE SACCO system to serve you better.</p>
    <p>Please check back shortly.</p>
    <p>Thank you for your patience and understanding.</p>
    <hr class="rule">
    <footer>
      <span class="name">BAKENYE Unity and Development SACCO</span>
      <span class="values">Transparency &bull; Accountability &bull; Unity &bull; Growth</span>
    </footer>
  </main>
</body>
</html>`;
}

/** Headers that go with the page. */
export function maintenanceHeaders(): HeadersInit {
  return {
    'content-type': 'text/html; charset=utf-8',
    // 503 + Retry-After is the honest answer, and the one that keeps the site's
    // existing search results rather than having them dropped as gone.
    'retry-after': '3600',
    // Even though the page is only ever served while maintenance is on, say it
    // twice: a header a crawler reads before parsing, and the meta tag inside.
    'x-robots-tag': 'noindex, nofollow',
    // Never let this page outlive maintenance in a CDN or a browser cache.
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  };
}
