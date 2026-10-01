/**
 * What a search engine sees.
 *
 * Runs against a running build and checks the two halves of the SEO work
 * separately, because they fail in opposite directions:
 *
 *   - the public half - the landing page, /help, robots.txt, sitemap.xml -
 *     must actually be indexable, with a canonical address on the SACCO's own
 *     domain and no invented claims in its structured data;
 *   - the private half - every member and staff screen - must be noindex, in
 *     the headers as well as in the markup, and must stay behind the login.
 *
 * The second half is the one worth a test. A page that quietly becomes
 * indexable publishes member records, and nothing about that failure is visible
 * on screen.
 *
 *   BASE_URL=http://127.0.0.1:3000 \
 *   SITE_URL=https://bakenye-sacco.online \
 *   node scripts/seo-check.mjs
 *
 * SITE_URL is the canonical origin the build was compiled with; the script
 * asserts the served pages agree with it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const SITE = (process.env.SITE_URL ?? 'https://bakenye-sacco.online').replace(/\/+$/, '');

let passed = 0;
const failures = [];

function ok(label, detail) {
  passed += 1;
  console.log(`  ✔ ${label}${detail ? ` — ${detail}` : ''}`);
}

function bad(label, detail) {
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ''}`);
}

function check(label, condition, detail) {
  if (condition) ok(label, detail);
  else bad(label, detail);
}

function section(title) {
  console.log(`\n── ${title}`);
}

async function get(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
  const body = res.headers.get('content-type')?.includes('image/') ? '' : await res.text();
  return { res, body };
}

/** Every `<meta name="x" content="y">` and `<meta property=...>` in the head. */
function metas(html) {
  const found = new Map();
  const re = /<meta\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const key = /(?:name|property)="([^"]+)"/i.exec(attrs)?.[1];
    const value = /content="([^"]*)"/i.exec(attrs)?.[1];
    if (key) found.set(key.toLowerCase(), decode(value ?? ''));
  }
  return found;
}

function linkHref(html, rel) {
  const re = new RegExp(`<link[^>]*rel="${rel}"[^>]*>`, 'i');
  const tag = re.exec(html)?.[0] ?? '';
  return decode(/href="([^"]*)"/i.exec(tag)?.[1] ?? '');
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function jsonLd(html) {
  const out = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch (e) {
      out.push({ __parseError: String(e) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

async function robots() {
  section('robots.txt');
  const { res, body } = await get('/robots.txt');
  check('it is served, without a redirect to the login screen', res.status === 200, `${res.status}`);
  check('it is plain text', (res.headers.get('content-type') ?? '').includes('text/plain'));
  check('the public site is allowed', /^Allow: \/$/m.test(body));
  check(
    'the whole site is NOT blocked',
    !/^Disallow: \/$/m.test(body),
    'a bare "Disallow: /" would de-index everything',
  );
  check(
    'it points at the production sitemap',
    body.includes(`Sitemap: ${SITE}/sitemap.xml`),
    `${SITE}/sitemap.xml`,
  );

  for (const path of [
    '/staff/',
    '/savings',
    '/shares',
    '/loans',
    '/transactions',
    '/statements',
    '/reports',
    '/profile',
    '/admin/',
    '/api/',
    '/login',
  ]) {
    check(`the management system is asked to be left alone: ${path}`, body.includes(`Disallow: ${path}`));
  }
}

async function sitemap() {
  section('sitemap.xml');
  const { res, body } = await get('/sitemap.xml');
  check('it is served, without a redirect', res.status === 200, `${res.status}`);
  check('it is XML', (res.headers.get('content-type') ?? '').includes('xml'));

  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('the homepage is listed, on the production domain', locs.includes(`${SITE}/`), `${SITE}/`);
  check('the help page is listed', locs.includes(`${SITE}/help`));
  check('and nothing else is', locs.length === 2, `${locs.length} url(s): ${locs.join(', ')}`);
  check(
    'no private path appears in it',
    !locs.some((l) => /\/(staff|savings|shares|loans|transactions|statements|reports|profile|admin|members)/.test(l)),
  );
  check(
    'no member or transaction identifier is enumerated in it',
    !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(body) && !/BND\d/.test(body),
  );
}

async function landing() {
  section('the public landing page at /');
  const { res, body } = await get('/');
  check('a signed-out visitor gets a page, not a redirect to /login', res.status === 200, `${res.status}`);
  check(
    'it is the landing page, not the member dashboard',
    body.includes('Your Trusted Partner in') && !body.includes('Welcome,'),
  );
  check(
    'it carries no X-Robots-Tag blocking it',
    !(res.headers.get('x-robots-tag') ?? '').includes('noindex'),
    res.headers.get('x-robots-tag') ?? 'none',
  );

  const m = metas(body);
  check('it is marked indexable', (m.get('robots') ?? '').includes('index') && !(m.get('robots') ?? '').includes('noindex'), m.get('robots'));
  check('googlebot is given a large image preview', (m.get('googlebot') ?? '').includes('max-image-preview:large'));
  check('the canonical URL is the production domain', linkHref(body, 'canonical') === SITE || linkHref(body, 'canonical') === `${SITE}/`, linkHref(body, 'canonical'));

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1] ?? '';
  check('it has a title naming the SACCO', /Bakenye/i.test(title) && /SACCO/i.test(title), title);
  check('the title is a sensible length for a result snippet', title.length >= 20 && title.length <= 70, `${title.length} chars`);

  const description = m.get('description') ?? '';
  check('it has a meta description', description.length > 50, `${description.length} chars`);
  check('the description is not truncated in search results', description.length <= 320, `${description.length} chars`);

  check('Open Graph: title', (m.get('og:title') ?? '').length > 10);
  check('Open Graph: description', (m.get('og:description') ?? '').length > 10);
  check('Open Graph: an absolute image URL', (m.get('og:image') ?? '').startsWith(SITE), m.get('og:image'));
  check('Open Graph: the canonical URL', (m.get('og:url') ?? '').startsWith(SITE), m.get('og:url'));
  check('Open Graph: the site name', (m.get('og:site_name') ?? '').includes('Bakenye'));
  check('Twitter: a large summary card', m.get('twitter:card') === 'summary_large_image', m.get('twitter:card'));
  check('Twitter: an image', (m.get('twitter:image') ?? '').startsWith(SITE));

  if (process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION) {
    check(
      'the Google Search Console tag carries the configured token',
      m.get('google-site-verification') === process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
      m.get('google-site-verification'),
    );
  } else {
    check(
      'no verification tag is invented when none is configured',
      !m.has('google-site-verification'),
      m.get('google-site-verification') ?? 'absent',
    );
  }

  // --- structured data ---
  const blocks = jsonLd(body);
  check('it publishes JSON-LD', blocks.length === 1, `${blocks.length} block(s)`);
  const graph = blocks[0]?.['@graph'] ?? [];
  check('the JSON-LD parses', !blocks.some((b) => b.__parseError), blocks[0]?.__parseError);
  const org = graph.find((n) => n['@type'] === 'Organization');
  const site = graph.find((n) => n['@type'] === 'WebSite');
  check('it describes an Organization', !!org);
  check('with the registered name', org?.name === 'Bakenye Unity and Development SACCO', org?.name);
  check('on the production domain', org?.url === `${SITE}/`, org?.url);
  check('with a logo that is an absolute URL', String(org?.logo ?? '').startsWith(SITE), org?.logo);
  check('and a WebSite node pointing back at it', site?.publisher?.['@id'] === org?.['@id']);

  const forbidden = ['address', 'aggregateRating', 'review', 'foundingDate', 'sameAs', 'numberOfEmployees', 'award'];
  for (const key of forbidden) {
    check(`nothing is invented: no "${key}" in the structured data`, !(key in (org ?? {})), JSON.stringify(org?.[key]));
  }

  const claims = /\b(largest|biggest|best|number one|no\.? ?1|government[- ]approved|guaranteed (returns|loans)|licensed by|regulated by)\b/i;
  check('the page makes no unsupported claim', !claims.test(stripTags(body)), claims.exec(stripTags(body))?.[0]);

  const h1 = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
  check('it has exactly one h1', h1.length === 1, `${h1.length}`);
}

function stripTags(html) {
  const main = html.slice(html.indexOf('<body'), html.indexOf('</body>') + 7);
  return main.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

async function helpPage() {
  section('/help');
  const { res, body } = await get('/help');
  check('it is served without a sign-in', res.status === 200, `${res.status}`);
  const m = metas(body);
  check('it is indexable', (m.get('robots') ?? '').startsWith('index'), m.get('robots'));
  check('its canonical is its own address', linkHref(body, 'canonical') === `${SITE}/help`, linkHref(body, 'canonical'));
  check('it has its own description', (m.get('description') ?? '').length > 50);
  check(
    'it carries no X-Robots-Tag blocking it',
    !(res.headers.get('x-robots-tag') ?? '').includes('noindex'),
    res.headers.get('x-robots-tag') ?? 'none',
  );
}

async function privatePages() {
  section('the management system stays out of Google');

  // Signed out, every one of these must send the visitor to /login - and must
  // say noindex on the way, because a redirect is still a crawlable URL.
  for (const path of [
    '/savings',
    '/shares',
    '/loans',
    '/transactions',
    '/statements',
    '/reports',
    '/profile',
    '/notifications',
    '/staff',
    '/staff/desk',
    '/staff/members',
    '/staff/finance',
    '/staff/reports',
    '/staff/settings',
  ]) {
    const { res } = await get(path);
    const redirected = res.status === 307 || res.status === 302;
    const target = res.headers.get('location') ?? '';
    check(
      `${path} is behind the login`,
      redirected && target.includes('/login'),
      `${res.status} ${target}`,
    );
    check(
      `${path} is served noindex`,
      (res.headers.get('x-robots-tag') ?? '').includes('noindex'),
      res.headers.get('x-robots-tag') ?? 'MISSING',
    );
  }

  // The pages that do render for a signed-out visitor, and still must not be
  // indexed: a sign-in form is not what the SACCO wants found.
  for (const path of ['/login', '/forgot-password']) {
    const { res, body } = await get(path);
    check(`${path} renders`, res.status === 200, `${res.status}`);
    check(
      `${path} carries the noindex header`,
      (res.headers.get('x-robots-tag') ?? '').includes('noindex'),
      res.headers.get('x-robots-tag') ?? 'MISSING',
    );
    check(
      `${path} says noindex in its markup too`,
      (metas(body).get('robots') ?? '').includes('noindex'),
      metas(body).get('robots'),
    );
  }
}

async function assets() {
  section('branding and assets a crawler fetches');
  for (const [path, type] of [
    ['/brand/og-image.png', 'image/png'],
    ['/favicon.ico', 'image/'],
    ['/icons/favicon-32.png', 'image/png'],
    ['/icons/icon-512.png', 'image/png'],
    ['/manifest.webmanifest', 'json'],
  ]) {
    const { res } = await get(path);
    check(`${path} is served`, res.status === 200, `${res.status} ${res.headers.get('content-type')}`);
    check(`${path} has the right type`, (res.headers.get('content-type') ?? '').includes(type));
  }

  const { res, body } = await get('/manifest.webmanifest');
  if (res.status === 200) {
    const manifest = JSON.parse(body);
    check('the manifest still names the SACCO', String(manifest.name ?? '').includes('Bakenye'), manifest.name);
    check('and still starts at /', manifest.start_url === '/', manifest.start_url);
  }
}

function sources() {
  section('the source agrees');
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  })('src');

  const offenders = files.filter((f) => {
    if (f.endsWith(join('lib', 'site.ts'))) return false; // the one legitimate default
    return /['"`]https?:\/\/localhost|['"`]http:\/\/127\.0\.0\.1/.test(readFileSync(f, 'utf8'));
  });
  check('no page or action hard-codes a localhost URL', offenders.length === 0, offenders.join(', '));

  const siteTs = readFileSync(join('src', 'lib', 'site.ts'), 'utf8');
  check('the production domain is declared once, centrally', (siteTs.match(/bakenye-sacco\.online/g) ?? []).length === 1);

  const hardcoded = files.filter(
    (f) => !f.endsWith(join('lib', 'site.ts')) && readFileSync(f, 'utf8').includes('bakenye-sacco.online'),
  );
  check('and nowhere else repeats it', hardcoded.length === 0, hardcoded.join(', '));
}

/**
 * The one check a browser is needed for: `/` serves two different pages, and
 * the rewrite that gives Google a landing page must not take the dashboard away
 * from the member who signed in. Run with a test account:
 *
 *   SEO_MEMBER_ID=BND26001 SEO_MEMBER_PASSWORD=... node scripts/seo-check.mjs
 *
 * Skipped, loudly, when no account is supplied.
 */
async function signedInHomepage() {
  section('a signed-in member still gets their dashboard at /');

  const identifier = process.env.SEO_MEMBER_ID;
  const password = process.env.SEO_MEMBER_PASSWORD;
  if (!identifier || !password) {
    console.log('  \u2013 skipped: set SEO_MEMBER_ID and SEO_MEMBER_PASSWORD to run this');
    return;
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="identifier"]', identifier);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/`, { timeout: 60_000 });

    await page.goto(`${BASE}/`);
    const html = await page.content();
    check('the member lands on their own dashboard', /Welcome,/.test(html));
    check('and not on the public landing page', !/Your Trusted Partner in/.test(html));
    const robotsMeta = await page.evaluate(
      () => document.querySelector('meta[name="robots"]')?.content ?? 'none',
    );
    check('that dashboard render is noindex', robotsMeta.includes('noindex'), robotsMeta);
  } finally {
    await browser.close();
  }
}

/* ------------------------------------------------------------------ */

await robots();
await sitemap();
await landing();
await helpPage();
await privatePages();
await assets();
await signedInHomepage();
sources();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
