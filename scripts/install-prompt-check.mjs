/**
 * Browser checks for the member app-installation prompt and the PWA setup
 * behind it, against a running application.
 *
 *   MEMBER_ID=BND26001 MEMBER_PASSWORD=... STAFF_ID=... STAFF_PASSWORD=... \
 *     node scripts/install-prompt-check.mjs [baseUrl]
 *
 * It reads screens, signs in and out, and records no money.
 *
 * `beforeinstallprompt` is not fired by headless Chromium, so the checks that
 * need a *real* install event install a stub that behaves the way Chrome's does
 * - preventDefault, prompt(), userChoice - before the page scripts run. That is
 * the contract the component codes against, and stubbing it is the only way to
 * exercise both branches (a real prompt, and a browser that offers none) in one
 * run.
 */
import { chromium } from 'playwright';

const B = process.argv[2] ?? 'http://127.0.0.1:3000';
const MEMBER = process.env.MEMBER_ID;
const MEMBER_PW = process.env.MEMBER_PASSWORD;
const STAFF = process.env.STAFF_ID;
const STAFF_PW = process.env.STAFF_PASSWORD;

if (!MEMBER || !MEMBER_PW) {
  console.error('Set MEMBER_ID and MEMBER_PASSWORD (a member number and its password).');
  process.exit(1);
}

const checks = [];
const add = (ok, label, detail = '') => {
  checks.push([ok, label, detail]);
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);

/** Chrome's install event, as the component uses it. */
const INSTALL_EVENT_STUB = `
  window.__installPromptCalls = 0;
  window.__installOutcome = 'accepted';
  class FakeBeforeInstallPrompt extends Event {
    constructor() { super('beforeinstallprompt', { cancelable: true }); }
    prompt() { window.__installPromptCalls += 1; return Promise.resolve(); }
    get userChoice() {
      return Promise.resolve({ outcome: window.__installOutcome, platform: 'web' });
    }
  }
  window.__fireInstallEvent = () => window.dispatchEvent(new FakeBeforeInstallPrompt());
  // Fired at DOMContentLoaded, which is where Chrome fires it: after the head
  // script has registered but before React has hydrated. That is the timing that
  // used to lose the event.
  document.addEventListener('DOMContentLoaded', () => window.__fireInstallEvent());
`;

async function newPage({ viewport, userAgent, standalone = false, withInstallEvent = true }) {
  const ctx = await browser.newContext({ viewport, userAgent });
  const page = await ctx.newPage();
  if (withInstallEvent) await page.addInitScript(INSTALL_EVENT_STUB);
  if (standalone) {
    // What a launched, installed app looks like to the page.
    await ctx.addInitScript(`
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) =>
        /display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} } : real(q);
      window.navigator.standalone = true;
    `);
  }
  return { ctx, page };
}

async function signIn(page, id, password) {
  await page.goto(`${B}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
}

const dialog = (page) => page.locator('dialog:has-text("Install")');
const waitForPrompt = (page, timeout = 6000) =>
  dialog(page).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

/* ======================================================================== */
console.log('\n── the PWA is installable at all');

{
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 900 } });
  const res = await page.goto(`${B}/manifest.webmanifest`, { waitUntil: 'domcontentloaded' });
  const manifest = JSON.parse(await page.locator('body').innerText());
  add(res?.status() === 200, 'the manifest is served', String(res?.status()));
  add(!!manifest.name && !!manifest.short_name, 'it has a name and a short name',
      `${manifest.name} / ${manifest.short_name}`);
  add(manifest.start_url === '/' && manifest.scope === '/', 'start URL and scope are the site root');
  add(manifest.display === 'standalone', 'display mode is standalone', manifest.display);
  add(!!manifest.theme_color && !!manifest.background_color, 'theme and background colours are set',
      `${manifest.theme_color} / ${manifest.background_color}`);
  add(manifest.icons?.some((i) => i.sizes === '192x192'), 'there is a 192px icon');
  add(manifest.icons?.some((i) => i.sizes === '512x512'), 'there is a 512px icon');
  add(manifest.icons?.some((i) => (i.purpose ?? '').includes('maskable')),
      'there is a maskable icon');

  for (const icon of manifest.icons ?? []) {
    const r = await page.request.get(`${B}${icon.src}`);
    add(r.ok() && (r.headers()['content-type'] ?? '').startsWith('image/'),
        `the icon ${icon.src} is served as an image`, `${r.status()} ${r.headers()['content-type']}`);
  }

  const sw = await page.request.get(`${B}/sw.js`);
  const swBody = await sw.text();
  add(sw.ok(), 'the service worker is served without a session', String(sw.status()));
  add(sw.headers()['service-worker-allowed'] === '/',
      'it is allowed to control the whole origin', sw.headers()['service-worker-allowed'] ?? 'absent');
  add(/addEventListener\(\s*'fetch'/.test(swBody),
      'it has a fetch handler, which is what installability requires');
  add(!/\/staff|\/api\//.test(swBody) && /method !== 'GET'/.test(swBody),
      'it caches no page and nothing that is not a GET for a static file');
  await ctx.close();
}

/* ======================================================================== */
console.log('\n── an eligible member');

{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page, MEMBER, MEMBER_PW);
  const landed = new URL(page.url()).pathname;
  add(!landed.startsWith('/login'), 'the member is signed in', landed);

  add(await waitForPrompt(page), 'the install prompt appears after signing in');
  const text = await dialog(page).first().innerText();
  add(/Install .*App/i.test(text), 'it offers to install the app', text.split('\n')[0]);
  add(/Install App/.test(text) && /Not Now/.test(text), 'both buttons are offered');

  // Not Now, and on with their business.
  await page.getByRole('button', { name: 'Not Now' }).click();
  await dialog(page).first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  add(!(await dialog(page).first().isVisible().catch(() => false)),
      'choosing Not Now closes it');
  add(new URL(page.url()).pathname === landed, 'the member stays where they were - no redirect',
      new URL(page.url()).pathname);

  // Moving around the portal in the same session must not ask again.
  for (const path of ['/savings', '/loans', '/']) {
    await page.goto(`${B}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    if (await dialog(page).first().isVisible().catch(() => false)) {
      add(false, `it is not shown again in the same session (${path})`);
      break;
    }
  }
  if (!checks.some(([, l]) => l.startsWith('it is not shown again'))) {
    add(true, 'it is not shown again in the same session, on any page');
  }

  // Sign out, sign back in without installing: asked again.
  await page.goto(`${B}/profile`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    await fetch('/auth/signout', { method: 'POST', redirect: 'manual' }).catch(() => {});
  });
  await page.goto(`${B}/login`, { waitUntil: 'networkidle' });
  await signIn(page, MEMBER, MEMBER_PW);
  add(await waitForPrompt(page), 'signing out and back in without installing asks again');
  await ctx.close();
}

/* ======================================================================== */
console.log('\n── installing it');

{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page, MEMBER, MEMBER_PW);
  await waitForPrompt(page);
  await page.getByRole('button', { name: /Install App/ }).click();
  await page.waitForTimeout(1200);
  const calls = await page.evaluate(() => window.__installPromptCalls);
  add(calls === 1, 'Install App triggers the browser\'s own install flow, once', `${calls} call(s)`);
  add(!(await dialog(page).first().isVisible().catch(() => false)),
      'accepting the browser prompt closes the modal');

  // An installed app is a new launch: the prompt must not come back.
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.goto(`${B}/savings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  add(!(await dialog(page).first().isVisible().catch(() => false)),
      'once installed the prompt no longer appears');
  await ctx.close();
}

/* ======================================================================== */
console.log('\n── already running as an installed app');

{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, standalone: true });
  await signIn(page, MEMBER, MEMBER_PW);
  await page.waitForTimeout(2500);
  add(!(await dialog(page).first().isVisible().catch(() => false)),
      'standalone mode is detected and the prompt is suppressed');
  await ctx.close();
}

/* ======================================================================== */
console.log('\n── a browser with no programmatic install');

{
  const { ctx, page } = await newPage({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    withInstallEvent: false,
  });
  await signIn(page, MEMBER, MEMBER_PW);
  add(await waitForPrompt(page), 'the prompt still appears');
  await page.getByRole('button', { name: /Install App|Show me how/ }).click();
  await page.waitForTimeout(600);
  const text = await dialog(page).first().innerText();
  add(/Home Screen/i.test(text) && /Share/i.test(text),
      'it shows this browser\'s own installation steps instead of a dead button',
      text.replace(/\s+/g, ' ').slice(0, 110));
  await ctx.close();
}

/* ======================================================================== */
console.log('\n── it fits every screen');

for (const [name, viewport] of [
  ['mobile 320', { width: 320, height: 568 }],
  ['mobile 390', { width: 390, height: 844 }],
  ['tablet 768', { width: 768, height: 1024 }],
  ['desktop 1440', { width: 1440, height: 900 }],
]) {
  const { ctx, page } = await newPage({ viewport });
  await signIn(page, MEMBER, MEMBER_PW);
  const shown = await waitForPrompt(page);
  let ok = shown;
  let detail = shown ? '' : 'never appeared';
  if (shown) {
    const box = await dialog(page).first().boundingBox();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    const btn = await page.getByRole('button', { name: 'Not Now' }).boundingBox();
    ok = !!box && box.width <= viewport.width && !overflow && !!btn && btn.height >= 44;
    detail = `dialog ${Math.round(box?.width ?? 0)}px, button ${Math.round(btn?.height ?? 0)}px, overflow ${overflow}`;
  }
  add(ok, `${name}: the prompt fits, does not overflow, and its buttons are tappable`, detail);
  await ctx.close();
}

/* ======================================================================== */
console.log('\n── staff are offered the app as well');

if (STAFF && STAFF_PW) {
  // The first release left staff out on purpose; the SACCO then asked for them to
  // be included. The workspace mounts the same modal in its own layout.
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page, STAFF, STAFF_PW);
  const landed = new URL(page.url()).pathname;
  add(landed.startsWith('/staff'), 'the staff member lands in the workspace', landed);
  add(await waitForPrompt(page), 'the install prompt appears for them too');
  // The offer is consumed the moment the modal opens, so by now the cookie may
  // already be spent. Either it is still there or it became the recorded nonce;
  // neither can exist unless the sign-in armed it.
  const armedStaff = await page.evaluate(() => ({
    cookie: document.cookie.includes('bnd_install_prompt='),
    nonce: sessionStorage.getItem('bnd_install_offered'),
  }));
  add(armedStaff.cookie || !!armedStaff.nonce, 'their sign-in armed the offer',
      armedStaff.cookie ? 'cookie still present' : `consumed into nonce ${armedStaff.nonce}`);
  await page.getByRole('button', { name: 'Not Now' }).click();
  await dialog(page).first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  add(new URL(page.url()).pathname === landed,
      'Not Now leaves them in the workspace - no redirect', new URL(page.url()).pathname);
  await ctx.close();
} else {
  console.log('  — skipped (set STAFF_ID and STAFF_PASSWORD)');
}

/* ======================================================================== */
console.log('\n── authentication is untouched');

{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  // A wrong password must still be refused, with the same message.
  await page.goto(`${B}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="identifier"]', MEMBER);
  await page.fill('input[type="password"]', 'definitely-not-the-password');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  add(new URL(page.url()).pathname.startsWith('/login') && /Invalid login credentials/i.test(body),
      'a wrong password is still refused on the sign-in screen');
  add(!(await dialog(page).first().isVisible().catch(() => false)),
      'and no install prompt appears for a failed sign-in');

  // A protected page still redirects a stranger to sign in.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const strangerPage = await fresh.newPage();
  await strangerPage.goto(`${B}/savings`, { waitUntil: 'networkidle' });
  add(new URL(strangerPage.url()).pathname === '/login',
      'a signed-out visitor is still sent to sign in', new URL(strangerPage.url()).pathname);
  add(new URL(strangerPage.url()).searchParams.get('next') === '/savings',
      'and their destination is still remembered - no redirect loop');
  await fresh.close();
  await ctx.close();
}

await browser.close();

const failed = checks.filter(([ok]) => !ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
