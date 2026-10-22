/** Validate the Overview's real presentation components using existing QA fixtures.
 * Start `npm run dev`, then run: node scripts/overview-check.mjs [baseUrl]
 * CHROMIUM_PATH optionally selects a system Chromium installation.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'work/overview-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
try {
  for (const width of [1855, 1440, 1280, 768, 767, 600, 480, 390, 360, 320]) {
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
    assert.equal(await hero.locator('p').first().textContent(), 'SACCO Overview · Super Admin');
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
    if (width < 768) {
      const cards = page.locator('[data-overview-metrics] [data-kpi], [aria-label="SACCO funds"] [data-kpi]');
      for (const card of await cards.all()) {
        const layout = await card.evaluate(el => {
          const header = el.querySelector(':scope > div:not([aria-hidden])');
          const label = header.querySelector('p');
          const chevron = header.lastElementChild.getBoundingClientRect();
          const icon = header.firstElementChild.getBoundingClientRect();
          const value = el.querySelector(':scope > div:last-child > div > div');
          const labelBox = label.getBoundingClientRect();
          const money = value.querySelector('.tabular');
          return {
            label: label.textContent,
            chevronCentered: Math.abs((icon.y + icon.height / 2) - (chevron.y + chevron.height / 2)) < 1,
            labelClear: labelBox.right + 8 <= chevron.left,
            valueFits: value.scrollWidth <= value.clientWidth + 1,
            moneyOneLine: !money || money.getBoundingClientRect().height <= parseFloat(getComputedStyle(value).lineHeight) + 1,
          };
        });
        assert.ok(layout.chevronCentered && layout.labelClear, `Heading and chevron alignment: ${width}px ${layout.label}`);
        assert.ok(layout.valueFits && layout.moneyOneLine, `Full currency value fits: ${width}px ${layout.label}`);
      }
      const fundBoxes = await funds.locator('[data-kpi]').evaluateAll(cards => cards.map(el => el.getBoundingClientRect().x));
      assert.equal(new Set(fundBoxes).size, 1, 'Treasury cards have a full readable row on mobile');
      const monthBoxes = await page.locator('figure svg > g:has(title) > text').evaluateAll(labels => labels.map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, height: r.height };
      }));
      for (let i = 1; i < monthBoxes.length; i++) assert.ok(monthBoxes[i].left - monthBoxes[i - 1].right >= 4, 'Chart month labels remain separated');
      assert.ok(monthBoxes.every(b => b.height >= 12), 'Chart labels have readable mobile height');
      assert.equal(await page.locator('figure').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'All chart periods fit without scrolling');
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
      await page.waitForFunction(() => Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().width) === 76);
      await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-sidebar]').getAttribute('data-collapsed') === 'false');
    } else {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      assert.ok(await page.getByRole('dialog', { name: 'Navigation' }).isVisible());
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog', { name: 'Navigation' }).count(), 0);
      assert.equal(await page.locator('dialog[aria-label="Navigation"]').evaluate(el => el.open), false);
    }
    await page.locator('[data-app-header] button[aria-haspopup="menu"]').click();
    assert.ok(await page.getByRole('menu').isVisible());
    await page.keyboard.press('Escape');
    await page.locator('details summary').click();
    assert.equal(await page.getByRole('link', { name: '12 months', exact: true }).getAttribute('href'), '/dev/preview/dashboard?flow=12#financial-activity');
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
  await page.goto(`${base}/dev/preview/dashboard?variant=admin`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('link', { name: 'SACCO overview', exact: true }).getAttribute('href'), '/staff');
  await page.goto(`${base}/staff`, { waitUntil: 'domcontentloaded' });
  assert.match(page.url(), /\/login/);
  await page.goto(`${base}/staff/admin`, { waitUntil: 'domcontentloaded' });
  assert.match(page.url(), /\/login/);
  await page.close();
  // Verify the existing role-specific destination used by the staff sidebar.
  const rbac = ts.transpileModule(await readFile('src/lib/rbac.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  const { landingPath } = await import(`data:text/javascript;base64,${Buffer.from(rbac).toString('base64')}`);
  assert.equal(landingPath({ roleKind: 'staff', dashboard: 'administration', permissions: ['dashboard.staff'] }), '/staff/admin');
  console.log('PASS existing Overview/admin navigation destinations and both signed-out route guards');
} finally {
  await browser.close();
}
