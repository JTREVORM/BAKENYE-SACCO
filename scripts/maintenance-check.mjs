/**
 * Maintenance mode, against a running application.
 *
 *   node scripts/maintenance-check.mjs [baseUrl]
 *
 * Run it twice: once with MAINTENANCE_MODE unset, once with it on. The suite
 * reads which state it is in from the site itself, so the same file covers both.
 *
 *   MAINTENANCE_BYPASS_TOKEN=<token>   also checks the maintainer bypass
 *
 * It only reads. It signs nothing in, writes nothing, and touches no data.
 */
const B = process.argv[2] ?? 'http://localhost:3000';
const TOKEN = process.env.MAINTENANCE_BYPASS_TOKEN;

const checks = [];
const add = (ok, label, detail = '') => {
  checks.push([ok, label, detail]);
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const get = (path, init = {}) =>
  fetch(`${B}${path}`, { redirect: 'manual', ...init });

const home = await get('/');
const maintenanceOn = home.status === 503;
console.log(`\n── the site is currently ${maintenanceOn ? 'IN maintenance mode' : 'serving normally'}`);

if (maintenanceOn) {
  const body = await home.text();

  console.log('\n── the page itself');
  add(home.status === 503, 'the root answers 503, not 200', String(home.status));
  add((home.headers.get('retry-after') ?? '') !== '', 'it carries Retry-After',
      home.headers.get('retry-after') ?? 'absent');
  add((home.headers.get('x-robots-tag') ?? '').includes('noindex'),
      'it carries X-Robots-Tag: noindex', home.headers.get('x-robots-tag') ?? 'absent');
  add((home.headers.get('cache-control') ?? '').includes('no-store'),
      'it is never cached, so it cannot outlive maintenance',
      home.headers.get('cache-control') ?? 'absent');
  add(/<meta name="robots" content="noindex/.test(body), 'and a noindex meta tag in the document');
  add(/System Under Maintenance/.test(body), 'it says System Under Maintenance');
  add(/BAKENYE Unity and Development SACCO/.test(body), 'it names the SACCO');
  add(/Transparency .*Accountability .*Unity .*Growth/s.test(body), 'the footer values are there');
  add(/viewport/.test(body) && /@media \(min-width: 640px\)/.test(body),
      'it is responsive rather than a desktop-only page');
  add(!/<script/i.test(body), 'it ships no JavaScript, so it renders whatever else is broken');

  console.log('\n── every area is behind it');
  for (const path of ['/', '/login', '/staff', '/staff/desk', '/savings', '/loans',
                      '/staff/finance/accounts', '/profile', '/help']) {
    const r = await get(path);
    add(r.status === 503, `${path} is held at the maintenance page`, String(r.status));
  }

  console.log('\n── but the things a browser needs still work');
  for (const [path, why] of [
    ['/icons/icon-192.png', 'the logo the page shows'],
    ['/manifest.webmanifest', 'the installed app does not break'],
    ['/sw.js', 'the service worker is not replaced by HTML'],
  ]) {
    const r = await get(path);
    add(r.ok, `${path} is still served (${why})`, String(r.status));
  }

  console.log('\n── no redirect loop');
  const chain = await get('/', { redirect: 'follow' }).catch((e) => ({ error: String(e) }));
  add(!chain.error && chain.status === 503,
      'following redirects from the root still lands on one 503',
      chain.error ?? String(chain.status));

  console.log('\n── the maintainer bypass');
  if (TOKEN) {
    const bad = await get('/maintenance-bypass?token=definitely-the-wrong-token-xxxxxxxx');
    add(bad.status === 404, 'a wrong token is refused, and says nothing', String(bad.status));

    const good = await get(`/maintenance-bypass?token=${encodeURIComponent(TOKEN)}`);
    add(good.status >= 300 && good.status < 400, 'the right token redirects in', String(good.status));
    const setCookie = good.headers.get('set-cookie') ?? '';
    add(/bnd_maintenance_bypass=/.test(setCookie), 'and sets the bypass cookie');
    add(/HttpOnly/i.test(setCookie), 'the cookie is httpOnly, so no script can read it');

    const cookie = setCookie.split(';')[0];
    const through = await get('/login', { headers: { cookie } });
    add(through.status === 200, 'carrying it, the sign-in screen loads normally',
        String(through.status));
    const throughBody = await through.text();
    add(!/System Under Maintenance/.test(throughBody), 'and it is the real screen, not the page');

    // The bypass is sight of the login screen, not a login.
    const still = await get('/staff/desk', { headers: { cookie } });
    add(still.status >= 300 && still.status < 400,
        'the bypass is not a login: a dashboard still redirects to sign in',
        String(still.status));
  } else {
    const none = await get('/maintenance-bypass?token=anything');
    add(none.status === 404, 'with no token configured there is no way past at all',
        String(none.status));
    console.log('  — set MAINTENANCE_BYPASS_TOKEN to exercise the bypass itself');
  }
} else {
  console.log('\n── maintenance is off, so the application must be untouched');
  add(home.status === 200 || (home.status >= 300 && home.status < 400),
      'the root answers normally', String(home.status));

  const login = await get('/login');
  add(login.status === 200, '/login loads', String(login.status));
  const loginBody = await login.text();
  add(!/System Under Maintenance/.test(loginBody), 'and shows no trace of the maintenance page');

  const staff = await get('/staff/desk');
  add(staff.status >= 300 && staff.status < 400,
      'a signed-out visitor to a dashboard is still sent to sign in', String(staff.status));
  add((staff.headers.get('location') ?? '').includes('/login'),
      'to /login, with their destination remembered', staff.headers.get('location') ?? '');

  for (const path of ['/manifest.webmanifest', '/sw.js', '/icons/icon-192.png']) {
    const r = await get(path);
    add(r.ok, `${path} still served`, String(r.status));
  }

  const bypass = await get('/maintenance-bypass?token=anything');
  add(bypass.status >= 300 && bypass.status < 400,
      'the bypass route mints nothing while maintenance is off', String(bypass.status));
}

const failed = checks.filter(([ok]) => !ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
