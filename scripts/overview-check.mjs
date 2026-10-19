/** Validate the Overview's real presentation components using existing QA fixtures.
 * Start `npm run dev`, then run: node scripts/overview-check.mjs [baseUrl]
 * CHROMIUM_PATH optionally selects a system Chromium installation.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'work/overview-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
try {
  for (const width of [1855, 1440, 1280, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    if (process.env.HTTPS_PROXY) {
      // Node trusts the managed proxy's CA; Chromium has a separate trust store.
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async route => {
        const response = await page.request.get(route.request().url());
        assert.ok(response.ok());
        await route.fulfill({ response });
      });
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/dev/preview/dashboard`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.evaluate(async () => {
      await document.fonts.load('20px "Material Symbols Outlined"');
      await document.fonts.ready;
    });
    const hero = page.locator('[data-hero]');
    assert.match(await hero.locator('h1').innerText(), /BAKENYE UNITY AND\s+DEVELOPMENT SACCO/);
    assert.match(await hero.locator('img').getAttribute('src'), /fisherman/);
    assert.equal(await hero.locator('dl dd').count(), 3);
    assert.deepEqual(await hero.locator('dl dd').allTextContents(), ['56', 'UGX 1,120,000', 'UGX 0']);
    assert.equal(await page.locator('[data-overview-metrics] [data-kpi]').count(), 4);
    assert.match(await page.locator('[data-overview-metrics]').innerText(), /Share Capital/);
    assert.match(await page.locator('[data-overview-metrics]').innerText(), /240,000/);
    assert.equal(await page.locator('figure svg rect').count(), 18);
    assert.match(await page.locator('figure svg').textContent(), /-UGX 2,650,000/);
    assert.equal(await page.locator('tbody tr').count(), 4);
    const funds = page.locator('[aria-label="SACCO funds"]');
    assert.equal(await funds.locator('[data-kpi]').count(), 4);
    for (const amount of ['UGX 6,730,000', 'UGX 485,000', 'UGX 4,145,000', 'UGX 2,100,000']) {
      assert.ok((await funds.innerText()).includes(amount));
    }
    const boxes = await Promise.all([hero, page.locator('[data-overview-metrics]'), page.locator('[data-admin-panels]'), funds].map(el => el.boundingBox()));
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].height, 'Reference section order is preserved');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page overflow at ${width}px`);
    const visibleDescriptions = page.locator('tbody tr').nth(2).locator('td').nth(3);
    if (await visibleDescriptions.isVisible()) {
      assert.equal(await visibleDescriptions.innerText(), 'Purchase of 240 share(s) at UGX 20,000 each');
      assert.equal(await visibleDescriptions.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    }
    if (width >= 768) {
      assert.equal(await page.locator('[data-sidebar] a[aria-current="page"]').count(), 1);
      await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(Math.round((await page.locator('[data-sidebar]').boundingBox()).width), 76);
      await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
      await page.waitForTimeout(250);
    } else {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      assert.ok(await page.getByRole('dialog', { name: 'Navigation' }).isVisible());
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[aria-label="Navigation"]').evaluate(el => el.parentElement.getAttribute('aria-hidden')), 'true');
    }
    await page.locator('[data-app-header] button[aria-haspopup="menu"]').click();
    assert.ok(await page.getByRole('menu').isVisible());
    await page.keyboard.press('Escape');
    await page.locator('details summary').click();
    assert.equal(await page.getByRole('link', { name: '12 months', exact: true }).getAttribute('href'), '/dev/preview/dashboard?flow=12');
    await page.locator('details summary').click();
    await page.addStyleTag({ content: 'nextjs-portal{display:none}' });
    await page.locator('main .overflow-y-auto').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${out}/overview-${width}.png` });
    if (width === 390) {
      const contentHeight = await page.locator('[data-overview-dashboard]').evaluate(el => Math.ceil(el.getBoundingClientRect().height));
      await page.setViewportSize({ width, height: contentHeight + 100 });
      await page.locator('main .overflow-y-auto').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `${out}/overview-390-full.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS Overview ${width}px: data, descriptions, chart, section order, navigation and no overflow`);
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto(`${base}/staff`, { waitUntil: 'domcontentloaded' });
  assert.match(page.url(), /\/login/);
  await page.close();
  console.log('PASS signed-out Overview redirects to login');
} finally {
  await browser.close();
}
