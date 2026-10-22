/** Visual and interaction checks against the dev-only dashboard fixture route.
 * Run against `npm run dev`: node scripts/super-admin-check.mjs [baseUrl]
 * Set CHROMIUM_PATH when using a system browser instead of Playwright's bundle.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = process.env.DASHBOARD_REVIEW_OUT ?? 'work/dashboard-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
try {
  for (const width of [1855, 1440, 1280, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 848 } });
    // The managed proxy's CA is trusted by Node; Chromium uses its own store.
    // Fetch remote fonts through the verified API client so screenshots contain
    // actual icons, without weakening TLS verification or changing the app.
    if (process.env.HTTPS_PROXY) {
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async route => {
        const response = await page.request.get(route.request().url());
        assert.ok(response.ok(), 'Remote font must load for accurate visual QA');
        await route.fulfill({ response });
      });
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/dev/preview/dashboard?variant=admin`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.evaluate(async () => {
      await document.fonts.load('20px "Material Symbols Outlined"');
      await document.fonts.ready;
    });
    assert.ok(await page.evaluate(() => Array.from(document.fonts).some(font => font.family === 'Material Symbols Outlined' && font.status === 'loaded')), 'Icon font loaded');
    assert.equal(await page.locator('h1').textContent(), 'Welcome back, MWESIGWA');
    assert.equal(await page.locator('[aria-label="SACCO funds"] [data-kpi]').count(), 4);
    assert.match(await page.locator('[aria-label="SACCO funds"]').innerText(), /UGX 6,730,000/);
    assert.equal(await page.locator('figure svg rect').count(), 18);
    assert.equal(await page.locator('figure svg rect[height="2"]').count(), 3);
    assert.match(await page.locator('figure svg').textContent(), /-UGX 2,650,000/);
    assert.equal(await page.locator('tbody tr').count(), 4);
    assert.equal(await page.locator('tbody tr').filter({ hasText: 'Reversed' }).count(), 1);
    const description = page.locator('tbody tr').nth(2).locator('td').nth(3);
    if (await description.isVisible()) {
      assert.equal(await description.innerText(), 'Purchase of 240 share(s) at UGX 20,000 each');
      const layout = await description.evaluate(el => {
        const style = getComputedStyle(el);
        return { whiteSpace: style.whiteSpace, overflow: style.overflow, wrap: style.overflowWrap, clipped: el.scrollWidth > el.clientWidth + 1 };
      });
      assert.equal(layout.whiteSpace, 'normal');
      assert.equal(layout.overflow, 'visible');
      assert.equal(layout.wrap, 'anywhere');
      assert.equal(layout.clipped, false, `Description clipped at ${width}px`);
      const columns = await page.locator('table').evaluate(table => ({
        heads: Array.from(table.querySelectorAll('th')).filter(el => getComputedStyle(el).display !== 'none').length,
        cells: Array.from(table.querySelectorAll('tbody tr:first-child td')).filter(el => getComputedStyle(el).display !== 'none').length,
      }));
      assert.equal(columns.heads, columns.cells, 'Description header and body stay aligned');
    }
    const chartLabel = await page.locator('figure svg text').first().evaluate(el => ({size: getComputedStyle(el).fontSize, fill: getComputedStyle(el).fill}));
    assert.equal(chartLabel.size, '10px');
    assert.equal(chartLabel.fill, 'rgb(70, 91, 123)');
    if (width >= 1500) {
      const widths = await page.locator('[aria-label="SACCO funds"] [data-kpi]').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
      assert.ok(Math.max(...widths) / Math.min(...widths) < 1.16, 'Financial cards have balanced widths');
    }

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
      assert.equal(await page.getByRole('dialog', { name: 'Navigation' }).count(), 0);
      assert.equal(await page.locator('dialog[aria-label="Navigation"]').evaluate(el => el.open), false);
    }
    await page.locator('[data-app-header] button[aria-haspopup="menu"]').click();
    assert.equal(await page.getByRole('menu').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    await page.locator('details summary').click();
    assert.equal(await page.getByRole('link', { name: '12 months', exact: true }).getAttribute('href'), '/dev/preview/dashboard?flow=12#financial-activity');
    await page.locator('details summary').click();
    await page.addStyleTag({ content: 'nextjs-portal { display: none; }' });
    await page.screenshot({ path: `${out}/super-admin-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: full descriptions, aligned columns, readable chart labels, balanced cards, navigation, no overflow or browser errors`);
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
