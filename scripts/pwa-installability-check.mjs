/**
 * Does Chrome itself consider this build installable, and does it fire the real
 * `beforeinstallprompt`?
 *
 *   MEMBER_ID=... MEMBER_PASSWORD=... \
 *     [STAFF_ID=... STAFF_PASSWORD=...] \
 *     [TEMP_MEMBER_ID=... TEMP_MEMBER_PASSWORD=...] \
 *     node scripts/pwa-installability-check.mjs [baseUrl]
 *
 * TEMP_MEMBER_* is a member still on a temporary password, which exercises the
 * first-sign-in path through "choose your password". That member's password is
 * changed by the run, so give it a throwaway account.
 *
 * WHY THIS EXISTS, SEPARATELY FROM install-prompt-check.mjs
 *
 * That suite stubs `beforeinstallprompt`, because it has to: it needs to drive
 * both the "browser offers a real install" and the "browser offers none" paths
 * in one run. The cost is that it never checks the thing a stub assumes - that
 * Chrome would have fired the event at all. A build can pass it with a manifest
 * Chrome rejects and a service worker Chrome ignores.
 *
 * This suite never stubs anything. It asks Chrome, over the DevTools Protocol,
 * for its own installability verdict (`Page.getInstallabilityErrors`) and its own
 * parse of the manifest (`Page.getAppManifest`), and it listens for the genuine
 * event.
 *
 * TWO THINGS IT MUST GET RIGHT, both of which cost a day to learn:
 *
 *   * a PERSISTENT context. Playwright's default context is incognito-like, and
 *     Chrome never fires `beforeinstallprompt` in incognito - it reports
 *     `in-incognito` and nothing else, which looks exactly like a healthy site.
 *   * `http://localhost` is a secure context as far as Chrome is concerned, so
 *     service workers and installability work without TLS. Any other hostname
 *     over plain HTTP is not, and everything here would fail for that reason
 *     alone.
 */
import { chromium } from 'playwright';
import { rmSync } from 'node:fs';

const B = process.argv[2] ?? 'http://localhost:3000';
const MEMBER = process.env.MEMBER_ID;
const MEMBER_PW = process.env.MEMBER_PASSWORD;
const STAFF = process.env.STAFF_ID;
const STAFF_PW = process.env.STAFF_PASSWORD;

if (!/^http:\/\/localhost(:|$)/.test(B) && !B.startsWith('https://')) {
  console.error(
    `Refusing to run against ${B}: Chrome only treats https:// and http://localhost as\n` +
    'secure contexts, and every check here would fail for that reason rather than a real one.',
  );
  process.exit(1);
}
if (!MEMBER || !MEMBER_PW) {
  console.error('Set MEMBER_ID and MEMBER_PASSWORD (a member number and its password).');
  process.exit(1);
}

const checks = [];
const add = (ok, label, detail = '') => {
  checks.push([ok, label, detail]);
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail ? ` — ${detail}` : ''}`);
};

let profileSeq = 0;
async function freshBrowser({ standalone = false } = {}) {
  const dir = `/var/tmp/pwa-check-profile-${process.pid}-${profileSeq++}`;
  rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: process.env.CHROME_PATH || undefined,
    viewport: { width: 390, height: 844 },
    args: ['--no-first-run'],
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  if (standalone) {
    await ctx.addInitScript(`
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => /display-mode:\\s*standalone/.test(q)
        ? { matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }
        : real(q);
    `);
  }
  await page.addInitScript(`window.__realBip = 0;
    window.addEventListener('beforeinstallprompt', () => { window.__realBip++; });`);
  return { ctx, page, dir };
}

async function signIn(page, id, pw) {
  await page.goto(`${B}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"], input[type="password"]', pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  // The submit button reads "Signing in..." while the action is in flight. On a
  // cold route that can outlast the navigation wait, so settle on it rather than
  // reporting a slow sign-in as a failed one.
  await page
    .locator('button[type="submit"]:has-text("Signing in")')
    .waitFor({ state: 'hidden', timeout: 30000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  if (new URL(page.url()).pathname.startsWith('/login')) {
    // Say why, rather than leaving a later assertion to fail mysteriously. The
    // sign-in screen pauses an identifier after repeated attempts, which a long
    // run can trip.
    const said = (await page.locator('form').first().innerText().catch(() => ''))
      .replace(/\s+/g, ' ').slice(0, 140);
    console.log(`     (sign-in did not leave /login — the screen says: ${said})`);
  }
}

/** Let the service worker register and take control, as a returning visit has. */
async function warmServiceWorker(page) {
  await page.goto(`${B}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
}

const dialog = (page) => page.locator('dialog:has-text("Install")').first();
const promptVisible = (page, timeout = 7000) =>
  dialog(page).waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

/* ===================================================================== */
console.log('\n── Chrome\'s own verdict on this build');
{
  const { ctx, page } = await freshBrowser();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.enable');
  await warmServiceWorker(page);

  const sw = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      count: regs.length,
      scopes: regs.map((r) => r.scope),
      states: regs.map((r) => r.active?.state ?? null),
      controlling: !!navigator.serviceWorker.controller,
      script: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  });
  add(sw.count === 1, 'the service worker registers', `${sw.count} registration(s) ${sw.scopes.join(',')}`);
  add(sw.states[0] === 'activated', 'it activates', String(sw.states[0]));
  add(sw.controlling, 'and it is controlling the page', sw.script ?? 'no controller');

  const manifest = await cdp.send('Page.getAppManifest');
  add((manifest.errors ?? []).length === 0, 'Chrome parses the manifest with no errors',
      JSON.stringify(manifest.errors ?? []));
  add(!!manifest.url && manifest.url.endsWith('/manifest.webmanifest'),
      'from /manifest.webmanifest', manifest.url ?? 'none');

  const errs = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors ?? [];
  const ids = errs.map((e) => e.errorId);
  // `in-incognito` here would mean the harness is wrong, not the site.
  add(!ids.includes('in-incognito'),
      'the test profile is a normal profile, not incognito',
      ids.includes('in-incognito') ? 'FIX THE HARNESS: use launchPersistentContext' : 'persistent context');
  add(errs.length === 0, 'Chrome reports NO installability errors',
      ids.length ? ids.join(', ') : 'none');

  const bip = await page.evaluate(() => ({
    fired: window.__realBip,
    captured: !!window.__bndInstallPromptEvent,
  }));
  add(bip.fired > 0, 'Chrome fires the real beforeinstallprompt', `${bip.fired} event(s)`);
  add(bip.captured, 'InstallEventCapture caught it before React hydrated');

  // Every icon the manifest claims must really be served as an image.
  const icons = JSON.parse(await page.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest');
    return JSON.stringify((await res.json()).icons ?? []);
  }));
  for (const icon of icons) {
    const r = await page.request.get(`${B}${icon.src}`);
    add(r.ok() && (r.headers()['content-type'] ?? '').startsWith('image/'),
        `icon ${icon.src} (${icon.sizes}, ${icon.purpose ?? 'any'}) is served as an image`,
        `${r.status()} ${r.headers()['content-type']}`);
  }
  await ctx.close();
}

/* ===================================================================== */
console.log('\n── a member signing in, with no stubs anywhere');
{
  const { ctx, page } = await freshBrowser();
  await warmServiceWorker(page);
  await signIn(page, MEMBER, MEMBER_PW);
  add(!new URL(page.url()).pathname.startsWith('/login'), 'the member is signed in',
      new URL(page.url()).pathname);

  // The cookie is consumed the moment the offer is made, and when the install
  // event was already captured that happens immediately - so look for either the
  // cookie still sitting there or the nonce it was turned into. Both prove the
  // sign-in armed the offer and the page could read it; neither can exist if the
  // server did not set it.
  const armed = await page.evaluate(() => ({
    cookie: document.cookie.includes('bnd_install_prompt='),
    nonce: sessionStorage.getItem('bnd_install_offered'),
  }));
  add(armed.cookie || !!armed.nonce,
      'the sign-in armed the offer, and the page could read it',
      armed.cookie ? 'cookie still present' : `consumed into nonce ${armed.nonce}`);

  add(await promptVisible(page), 'the install modal appears');
  const text = await dialog(page).innerText();
  add(/Install .*App/i.test(text) && /Install App/.test(text) && /Not Now/.test(text),
      'it offers Install App and Not Now', text.split('\n')[0]);

  // The offer is recorded against this sign-in, not by the cookie's absence.
  const recorded = await page.evaluate(() => sessionStorage.getItem('bnd_install_offered'));
  add(!!recorded, 'the offer is recorded against this sign-in');

  // Chrome's own dialog. We cannot click through Chrome's native UI, but we can
  // prove prompt() was accepted rather than throwing.
  // `prompt()` opens Chrome's own install dialog, which this harness cannot
  // dismiss, so the promise may simply never settle. What we are testing is that
  // Chrome ACCEPTS the call - a stale or already-used event throws synchronously
  // or rejects - so a call still pending after a moment is a pass, not a hang.
  const outcome = await page.evaluate(async () => {
    const e = window.__bndInstallPromptEvent;
    if (!e) return 'no-event';
    try {
      const settled = await Promise.race([
        e.prompt().then(() => 'prompt-accepted'),
        new Promise((r) => setTimeout(() => r('prompt-accepted (dialog open)'), 2500)),
      ]);
      return settled;
    } catch (err) {
      return 'threw: ' + err.message;
    }
  });
  add(outcome.startsWith('prompt-accepted'),
      'Install App can trigger Chrome\'s native install flow', outcome);

  // Moving around the portal must not ask again.
  let again = false;
  for (const p of ['/savings', '/loans', '/']) {
    await page.goto(`${B}${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    if (await dialog(page).isVisible().catch(() => false)) { again = true; break; }
  }
  add(!again, 'it is not shown again anywhere in the same session');
  await ctx.close();
}

/* ===================================================================== */
console.log('\n── signing out and back in offers again');
{
  const { ctx, page } = await freshBrowser();
  await warmServiceWorker(page);
  await signIn(page, MEMBER, MEMBER_PW);
  add(await promptVisible(page), 'offered on the first sign-in');
  await page.getByRole('button', { name: 'Not Now' }).click();
  const firstNonce = await page.evaluate(() => sessionStorage.getItem('bnd_install_offered'));

  await page.evaluate(() => fetch('/auth/signout', { method: 'POST', redirect: 'manual' }).catch(() => {}));
  await page.goto(`${B}/login`, { waitUntil: 'networkidle' });
  await signIn(page, MEMBER, MEMBER_PW);
  add(await promptVisible(page), 'offered again after signing out and back in');
  const secondNonce = await page.evaluate(() => sessionStorage.getItem('bnd_install_offered'));
  add(!!firstNonce && !!secondNonce && firstNonce !== secondNonce,
      'the second sign-in is a different sign-in, not a replay');
  await ctx.close();
}

/* ===================================================================== */
console.log('\n── a member who already installed it is left alone');
{
  const { ctx, page } = await freshBrowser();
  await warmServiceWorker(page);
  // What the browser records when an install succeeds.
  await page.evaluate(() => localStorage.setItem('bnd_app_installed', '1'));
  await signIn(page, MEMBER, MEMBER_PW);
  await page.waitForTimeout(4000);
  add(!(await dialog(page).isVisible().catch(() => false)),
      'an installed member is not offered the app again, even in an ordinary tab');
  await ctx.close();
}
{
  const { ctx, page } = await freshBrowser({ standalone: true });
  await warmServiceWorker(page);
  await signIn(page, MEMBER, MEMBER_PW);
  await page.waitForTimeout(4000);
  add(!(await dialog(page).isVisible().catch(() => false)),
      'running standalone is not offered the app either');
  await ctx.close();
}

/* ===================================================================== */
console.log('\n── a first sign-in, which goes through "choose your password"');
if (process.env.TEMP_MEMBER_ID && process.env.TEMP_MEMBER_PASSWORD) {
  // A member created by an officer signs in on a temporary password and must
  // replace it before anything else opens. That detour happens outside the member
  // area, so the offer has to survive it and be made once they are let in. This
  // is the path that used to drop the offer entirely.
  const { ctx, page } = await freshBrowser();
  await warmServiceWorker(page);
  await signIn(page, process.env.TEMP_MEMBER_ID, process.env.TEMP_MEMBER_PASSWORD);
  const atChange = new URL(page.url()).pathname;
  add(atChange === '/change-password',
      'a temporary password sends the member to choose a new one', atChange);

  if (atChange !== '/change-password') {
    // Without that screen there is nothing to drive, and pressing on would throw
    // on a field that is not there. Say so plainly and move to the next section.
    console.log('     (skipping the rest of this section - the password screen was never reached)');
    await ctx.close();
  } else {
  add(!(await dialog(page).isVisible().catch(() => false)),
      'the offer is not made on the password screen, which is outside the portal');

  // Three fields: the temporary password they were given, and the new one twice.
  const fresh = 'ChosenByMember' + Date.now().toString().slice(-5) + '!';
  await page.fill('input[name="current_password"]', process.env.TEMP_MEMBER_PASSWORD);
  await page.fill('input[name="password"]', fresh);
  await page.fill('input[name="confirm"]', fresh);
  await Promise.all([
    page.waitForURL((u) => u.pathname !== '/change-password', { timeout: 60000 }).catch(() => {}),
    page.locator('button[type="submit"]').first().click(),
  ]);
  console.log(`     (this member's password is now ${fresh})`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const landed = new URL(page.url()).pathname;
  add(!landed.startsWith('/change-password') && !landed.startsWith('/login'),
      'choosing a password lets them into the portal', landed);
  add(await promptVisible(page),
      'and the app is offered for that sign-in');
  await ctx.close();
  }
} else {
  console.log('  — skipped (set TEMP_MEMBER_ID and TEMP_MEMBER_PASSWORD)');
}

/* ===================================================================== */
console.log('\n── staff are offered the app too');
if (STAFF && STAFF_PW) {
  // The first release deliberately left staff out. The SACCO asked for them to be
  // included, so the workspace mounts the same modal in its own layout - these
  // checks are the ones that would fail if that mount were ever dropped.
  const { ctx, page } = await freshBrowser();
  await warmServiceWorker(page);
  await signIn(page, STAFF, STAFF_PW);
  const landed = new URL(page.url()).pathname;
  add(landed.startsWith('/staff'), 'the staff member lands in the workspace', landed);
  add(await promptVisible(page), 'the install modal appears for a staff sign-in');
  const text = await dialog(page).innerText();
  add(/Install .*App/i.test(text) && /Install App/.test(text) && /Not Now/.test(text),
      'with the same Install App and Not Now buttons', text.split('\n')[0]);

  // Dismissing it must leave them in the workspace, not bounce them anywhere.
  await page.getByRole('button', { name: 'Not Now' }).click();
  await dialog(page).waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  add(new URL(page.url()).pathname === landed,
      'Not Now leaves them where they were - no redirect', new URL(page.url()).pathname);

  // And it must not follow them around the workspace.
  let again = false;
  for (const p of ['/staff/members', '/staff/transactions', landed]) {
    await page.goto(`${B}${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    if (await dialog(page).isVisible().catch(() => false)) { again = true; break; }
  }
  add(!again, 'and it is not shown again elsewhere in the workspace');
  await ctx.close();
} else {
  console.log('  — skipped (set STAFF_ID and STAFF_PASSWORD)');
}

/* ===================================================================== */
console.log('\n── a staff member who already installed it is left alone');
if (STAFF && STAFF_PW) {
  const { ctx, page } = await freshBrowser();
  await warmServiceWorker(page);
  await page.evaluate(() => localStorage.setItem('bnd_app_installed', '1'));
  await signIn(page, STAFF, STAFF_PW);
  await page.waitForTimeout(4000);
  add(!(await dialog(page).isVisible().catch(() => false)),
      'an installed staff member is not offered the app again');
  await ctx.close();
} else {
  console.log('  — skipped (set STAFF_ID and STAFF_PASSWORD)');
}

const failed = checks.filter(([ok]) => !ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
