/**
 * Content-Security-Policy (F-09).
 *
 * Production sends `X-Content-Type-Options`, `X-Frame-Options`,
 * `Referrer-Policy`, `Permissions-Policy` and HSTS, and had no CSP. The XSS
 * surface today is genuinely small - one `dangerouslySetInnerHTML` injecting a
 * static constant, no `eval`, no `new Function`, every input validated with
 * zod - so this is defence in depth rather than a live hole. For software
 * holding members' savings, shares and loan balances it is still the control
 * that limits the damage of any future injection, including one arriving
 * through a compromised dependency.
 *
 * REPORT-ONLY UNTIL PROVEN
 *
 * `CSP_MODE` decides what is sent, and the default is the cautious one:
 *
 *   unset / 'report-only'  Content-Security-Policy-Report-Only
 *                          The browser reports what the policy *would* have
 *                          blocked and blocks nothing. This is the default so
 *                          that deploying this code cannot break sign-in,
 *                          a receipt or a posting.
 *   'enforce'              Content-Security-Policy
 *                          Only after the report-only run comes back clean
 *                          across the flows listed in the release runbook.
 *   'off'                  no CSP header at all, for bisecting a problem.
 *
 * THE NONCE, AND WHY IT IS SET ON THE REQUEST TOO
 *
 * Next.js inlines its own bootstrap and streaming-data scripts, so a policy
 * without `'unsafe-inline'` has to let those through by nonce. Next reads that
 * nonce from the *request's* `Content-Security-Policy` header and stamps it
 * onto the scripts it renders. The middleware therefore sets the policy on the
 * request under the enforcing name - which is what Next looks for - and on the
 * response under whichever name the mode calls for. Without that, a
 * report-only run would drown in reports about Next's own scripts and tell us
 * nothing about ours.
 *
 * `'strict-dynamic'` lets a script that was itself allowed by nonce load the
 * further chunks Next splits the app into, without naming every one.
 *
 * WHAT HAS TO HOLD BEFORE 'enforce'
 *
 *  1. A report-only run with no violations across: sign-in, the forced
 *     first-password change, a profile password change, a staff password
 *     reset, recording a collection end to end, a receipt on screen, that
 *     receipt printed to A4 PDF, the member register and its CSV download,
 *     and installing the PWA.
 *  2. `InstallEventCapture`'s inline script carries the nonce (it is the one
 *     `dangerouslySetInnerHTML` in the codebase). Under report-only it merely
 *     reports; under enforcement it would be blocked, and the PWA install
 *     prompt would stop being offered.
 *  3. `NEXT_PUBLIC_SUPABASE_URL` is set, so `connect-src` and `img-src` name
 *     the real project host. If it is missing the policy below omits it, and
 *     every Supabase call would be blocked under enforcement.
 */

/** Which header to send, if any. */
export type CspMode = 'off' | 'report-only' | 'enforce';

export function cspMode(): CspMode {
  const raw = process.env.CSP_MODE?.trim().toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'enforce') return 'enforce';
  // Anything else, including unset and a typo, is the safe one.
  return 'report-only';
}

/** The response header name for a mode. `off` has none. */
export function cspHeaderName(mode: CspMode): string | null {
  if (mode === 'off') return null;
  return mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

/** A fresh nonce per request. Base64 of 16 random bytes, via Web Crypto so it works on the edge. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The Supabase project origin, if configured, for `connect-src` and `img-src`. */
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The policy itself.
 *
 * Each directive is here because something in this application needs exactly
 * that much and no more:
 *
 *   script-src    Next's nonced bootstrap, and the chunks it then loads.
 *   style-src     Next inlines critical CSS, so inline styles are allowed.
 *                 Styles cannot exfiltrate data the way a script can, and the
 *                 alternative is a nonce on every injected style block.
 *   img-src       profile photos from Supabase Storage, `data:` for the brand
 *                 marks and anything a receipt draws, `blob:` for an image the
 *                 browser generates while printing.
 *   connect-src   the Supabase REST and Auth calls the browser makes with the
 *                 anon key, plus its websocket origin.
 *   font-src      self and `data:`, which is how the bundled fonts arrive.
 *   worker-src    the service worker that makes the app installable.
 *   form-action   every form in this application posts to this origin.
 *   frame-src     nothing is embedded, and `frame-ancestors 'none'` says this
 *                 application is never embedded either - the CSP equivalent of
 *                 the `X-Frame-Options: DENY` already sent.
 */
export function buildCsp(nonce: string): string {
  const supabase = supabaseOrigin();
  const connect = ["'self'"];
  const img = ["'self'", 'data:', 'blob:'];
  if (supabase) {
    connect.push(supabase, supabase.replace(/^https:/, 'wss:'));
    img.push(supabase);
  }

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  // Only when a collector is configured; a dangling report endpoint is noise.
  const reportUri = process.env.CSP_REPORT_URI?.trim();
  if (reportUri) directives.push(`report-uri ${reportUri}`);

  return directives.join('; ');
}
