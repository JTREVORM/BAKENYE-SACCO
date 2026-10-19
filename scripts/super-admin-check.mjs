/** Visual and interaction checks against the dev-only dashboard fixture route.
 * Run against `npm run dev`: node scripts/super-admin-check.mjs [baseUrl]
 * Set CHROMIUM_PATH when using a system browser instead of Playwright's bundle.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'work/dashboard-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
try {
  for (const width of [1855, 1440, 1280, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 848 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/dev/preview/dashboard?variant=admin`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('h1').textContent(), 'Welcome back, MWESIGWA');
    assert.equal(await page.locator('[aria-label="SACCO funds"] [data-kpi]').count(), 4);
    assert.match(await page.locator('[aria-label="SACCO funds"]').innerText(), /UGX 6,730,000/);
    assert.equal(await page.locator('figure svg rect').count(), 18);
    assert.equal(await page.locator('figure svg rect[height="2"]').count(), 3);
    assert.match(await page.locator('figure svg').textContent(), /-UGX 2,650,000/);
    assert.equal(await page.locator('tbody tr').count(), 4);
    assert.equal(await page.locator('tbody tr').filter({ hasText: 'Reversed' }).count(), 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Page overflows at ${width}px`);
    if (width >= 768) {
      const sidebar = page.locator('[data-sidebar]');
      assert.equal(await sidebar.locator('a[aria-current="page"]').count(), 1);
      await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(Math.round((await sidebar.boundingBox()).width), 76);
      await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
      await page.waitForTimeout(250);
    } else {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      assert.equal(await page.getByRole('dialog', { name: 'Navigation' }).isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[aria-label="Navigation"]').evaluate(el => el.parentElement.getAttribute('aria-hidden')), 'true');
    }
    await page.locator('[data-app-header] button[aria-haspopup="menu"]').click();
    assert.equal(await page.getByRole('menu').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    await page.locator('details summary').click();
    assert.equal(await page.getByRole('link', { name: '12 months', exact: true }).getAttribute('href'), '/dev/preview/dashboard?flow=12');
    await page.locator('details summary').click();
    await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
    await page.screenshot({ path: `${out}/super-admin-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: figures, chart, transaction states, navigation, account menu, range picker, no overflow or browser errors`);
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(`${base}/staff/admin`, { waitUntil: 'domcontentloaded' });
  assert.match(page.url(), /\/login/);
  console.log('PASS protected dashboard redirects signed-out users to login');
  await page.close();
} finally {
  await browser.close();
}
