/** Development-only fixtures; never signs in or submits a financial action.
 * npm run dev, then CHROMIUM_PATH=/usr/bin/chromium node scripts/staff-dashboards-check.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'work/staff-review';
const widths = [1855, 1440, 1280, 1024, 768, 600, 390, 320];
const dashboards = {
  administration: { role: 'Admin', heading: 'Active staff accounts', route: '/staff/admin' },
  cashier: { role: 'Cashier / Teller', heading: 'Collected today', route: '/staff/desk' },
  loans: { role: 'Loan Officer', heading: 'Awaiting assessment', route: '/staff/loans-desk' },
  finance: { role: 'Accountant', heading: 'Total SACCO Funds', route: '/staff/finance' },
  collections: { role: 'Field Officer', heading: 'Record savings', route: '/staff/savings/collect' },
};
const selected = process.argv[3]?.split(',') ?? Object.keys(dashboards);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
});
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const fonts = new Map();
  if (process.env.HTTPS_PROXY) await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async route => {
    const url = route.request().url();
    if (!fonts.has(url)) fonts.set(url, (async () => {
      const response = await context.request.get(url);
      assert.ok(response.ok());
      return { status: response.status(), headers: response.headers(), body: await response.body() };
    })());
    await route.fulfill(await fonts.get(url));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [dashboard, spec] of Object.entries(dashboards).filter(([name]) => selected.includes(name))) {
    await page.setViewportSize({ width: 1855, height: 1100 });
    await page.goto(`${base}/dev/preview/staff/${dashboard}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.evaluate(async () => { await document.fonts.load('20px "Material Symbols Outlined"'); await document.fonts.ready; });
    assert.match(await page.locator('[data-hero] p').first().textContent(), new RegExp(`${spec.role.replace('/', '\\/')} Dashboard`));
    assert.equal(await page.getByRole('link', { name: 'SACCO overview', exact: true }).getAttribute('href'), '/staff');
    assert.ok((await page.locator('[data-staff-dashboard]').innerText()).includes(spec.heading), `The ${dashboard} content is present`);
    assert.equal(await page.locator('a[href="#"]').count(), 0, 'No placeholder links');
    assert.equal(await page.locator('[data-app-header] a[href="/staff/savings/record"]').count(), ['administration', 'cashier', 'collections'].includes(dashboard) ? 1 : 0, 'Header action matches the existing savings.record permission');
    if (dashboard === 'cashier') {
      const receipts = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Receipts you issued today', exact: true }) });
      assert.ok((await receipts.innerText()).includes('No receipts yet today'), 'Historical fixture transactions are not shown as today’s receipts');
      assert.equal(await receipts.locator('li').count(), 0);
      assert.equal(await page.getByRole('link', { name: 'Register member', exact: true }).count(), 0);
    }
    if (dashboard === 'finance') {
      const today = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' }).format(new Date());
      const activity = page.locator('section').filter({ has: page.getByRole('heading', { name: "Today's activity", exact: true }) });
      assert.ok((await activity.innerText()).includes(today), 'Today’s activity uses today in Uganda');
      assert.ok((await page.locator('[aria-labelledby="total-funds"]').innerText()).includes(today), 'Treasury snapshot uses the same QA date');
      const ledger = page.getByRole('region', { name: 'Account ledger', exact: true });
      const payout = ledger.getByRole('row').filter({ hasText: 'LDS260820001' });
      assert.match(await payout.innerText(), /Payment/);
      assert.doesNotMatch(await payout.innerText(), /Member collection/);
      assert.ok((await payout.innerText()).includes('2,050,000'));
      const repayment = ledger.getByRole('row').filter({ hasText: 'LRP260829002' });
      assert.ok((await repayment.innerText()).includes('Airtel Collections'));
      assert.ok((await repayment.innerText()).includes('485,000'));
      assert.equal(await ledger.getByRole('row').filter({ hasText: 'SHR260812001' }).count(), 0, 'Unpaired reversed sample is not fabricated as a posted ledger entry');
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1100 });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${dashboard} ${width}: page overflow`);
      assert.equal(await page.locator('main .overflow-y-auto').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${dashboard} ${width}: main content overflow`);
      const clipped = await page.locator('[data-staff-dashboard] [data-kpi] > div:last-child > div > div').evaluateAll(values => values.flatMap(el => {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        return el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > lineHeight + 1 ? [el.textContent] : [];
      }));
      assert.deepEqual(clipped, [], `${dashboard} ${width}: KPI amounts stay complete on one line`);
      const collisions = await page.locator('[data-staff-dashboard] [data-kpi]').evaluateAll(cards => cards.flatMap(card => {
        const header = card.querySelector(':scope > div:not([aria-hidden])');
        const label = header.querySelector('p');
        const icon = header.firstElementChild.getBoundingClientRect();
        const chevron = header.lastElementChild;
        if (chevron === label) return [];
        const c = chevron.getBoundingClientRect();
        return label.getBoundingClientRect().right > c.left - 4 || Math.abs(icon.y + icon.height / 2 - c.y - c.height / 2) > 1 ? [label.textContent] : [];
      }));
      assert.deepEqual(collisions, [], `${dashboard} ${width}: headings and chevrons align`);
      if (width < 768) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        assert.ok(await page.getByRole('dialog', { name: 'Navigation' }).isVisible());
        await page.keyboard.press('Escape');
      } else {
        assert.equal(await page.locator('[data-sidebar] a[aria-current="page"]').count(), 1);
      }
      if (dashboard === 'finance') {
        for (const amount of ['UGX 6,730,000', 'UGX 485,000', 'UGX 4,145,000', 'UGX 2,100,000']) assert.ok((await page.locator('[data-staff-dashboard]').innerText()).includes(amount));
        assert.equal(await page.locator('svg[aria-label="Money received and Money paid out by month"]').count(), 1);
        const monthLabels = await page.locator('figure svg > g:has(title) > text').evaluateAll(labels => labels.map(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; }));
        for (let i = 1; i < monthLabels.length; i++) assert.ok(monthLabels[i].left > monthLabels[i - 1].right + 2, 'Financial chart month labels remain separate');
        if (width >= 768) {
          const region = page.getByRole('region', { name: 'Account ledger', exact: true });
          assert.ok(await region.isVisible());
          assert.equal(await region.getAttribute('tabindex'), '0');
          const description = region.locator('[data-ledger-description] > span:last-child').first();
          const text = await description.textContent();
          await description.evaluate(el => { el.textContent = Array(6).fill(el.textContent).join(' '); });
          assert.ok(await description.evaluate(el => el.clientHeight >= el.scrollHeight - 1), 'Long transaction descriptions are fully expanded');
          await description.evaluate((el, original) => { el.textContent = original; }, text);
          const right = page.getByRole('button', { name: 'Account ledger: scroll right', exact: true });
          for (let i = 0; i < 10 && await right.isEnabled(); i++) { await right.click(); await page.waitForTimeout(100); }
          assert.ok(await right.isDisabled(), 'Ledger end is reachable using visible controls');
          const balance = region.getByRole('columnheader', { name: 'Balance (UGX)', exact: true });
          const r = await region.boundingBox(), b = await balance.boundingBox();
          assert.ok(b.x >= r.x - 1 && b.x + b.width <= r.x + r.width + 1, 'Balance column is fully visible at the ledger end');
          const end = await region.evaluate(el => el.scrollLeft);
          await region.focus(); await region.press('ArrowLeft'); await page.waitForTimeout(100);
          assert.ok(await region.evaluate(el => el.scrollLeft) < end, 'The ledger also scrolls with the keyboard');
          if (width === 1855) {
            await region.evaluate(el => { el.scrollLeft = el.scrollWidth; el.blur(); });
            await page.waitForTimeout(100);
            await region.locator('..').screenshot({ path: `${out}/finance-ledger-end.png` });
          }
          await region.evaluate(el => { el.scrollLeft = 0; });
        }
      }
      if (dashboard === 'collections') {
        assert.match(await page.locator('[data-staff-dashboard]').innerText(), /Nakabugo Christine Ssemakula/);
        const stats = await page.locator('[data-staff-dashboard] section dd').evaluateAll(items => items.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
        assert.deepEqual(stats, [], `${width}px: collection financial figures are readable`);
        const amounts = await page.locator('[data-staff-dashboard] table td.tabular').evaluateAll(items => items.filter(el => getComputedStyle(el).whiteSpace !== 'nowrap').map(el => el.textContent));
        assert.deepEqual(amounts, [], 'Savings table figures stay together');
        if (width < 768) {
          const months = page.getByRole('list', { name: 'Savings by month', exact: true });
          assert.ok(await months.isVisible());
          for (const row of await months.locator(':scope > li').all()) {
            assert.ok(await row.getByText('Last deposit', { exact: true }).isVisible());
            const action = row.getByRole('button');
            assert.ok(await action.isVisible());
            assert.ok((await action.boundingBox()).height >= 44);
            assert.equal(await row.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
          }
          const month = months.locator(':scope > li').nth(1);
          const cycle = await month.locator('h3').innerText();
          await month.getByRole('button').click();
          assert.ok((await page.getByRole('dialog').innerText()).includes(cycle), 'Month-specific action opens the correct period');
          await page.keyboard.press('Escape');
        }
        await page.getByRole('button', { name: 'Record savings', exact: true }).click();
        assert.ok(await page.getByRole('dialog').isVisible());
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').count(), 0);
      }
      await page.addStyleTag({ content: 'nextjs-portal{display:none}' });
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.locator('main .overflow-y-auto').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: `${out}/${dashboard}-${width}.png` });
      if (width === 390 || width === 1855) {
        const height = await page.locator('[data-staff-dashboard]').evaluate(el => {
          const scroll = getComputedStyle(el.closest('main .overflow-y-auto'));
          return Math.ceil(el.getBoundingClientRect().height + document.querySelector('[data-app-header]').getBoundingClientRect().height + parseFloat(scroll.paddingTop) + parseFloat(scroll.paddingBottom)) + 4;
        });
        await page.setViewportSize({ width, height });
        await page.locator('main .overflow-y-auto').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: `${out}/${dashboard}-${width === 390 ? 'mobile' : 'desktop'}-full.png` });
      }
      assert.deepEqual(errors, [], `${dashboard}: no browser errors`);
      console.log(`PASS ${dashboard} ${width}px: labels, amounts, navigation, no overflow or browser errors`);
    }
    // The restricted fixture uses the production presentation's read-only state.
    await page.goto(`${base}/dev/preview/staff/${dashboard}?limited=1`, { waitUntil: 'networkidle' });
    if (dashboard === 'administration' || dashboard === 'cashier') assert.equal(await page.locator('[aria-label="SACCO funds"]').count(), 0);
    if (dashboard === 'administration') {
      assert.equal(await page.locator('[aria-label="Accounts and sign-in"]').count(), 0);
      assert.equal(await page.getByRole('link', { name: 'Staff accounts', exact: true }).count(), 0);
    }
    if (dashboard === 'finance') assert.equal(await page.locator('section[aria-label="Quick actions"]').count(), 0);
    assert.equal(await page.locator('[data-app-header] a[href="/staff/savings/record"]').count(), 0);
    if (dashboard === 'collections') {
      assert.ok(await page.getByRole('button', { name: 'Record savings', exact: true }).isDisabled());
      assert.equal(await page.getByRole('button', { name: /^Record savings for / }).count(), 0);
    }
    await page.goto(`${base}${spec.route}`, { waitUntil: 'domcontentloaded' });
    assert.match(page.url(), /\/login/, `${spec.route} still requires authentication`);
  }
  // Exercise the unchanged destination and permission-fallback contract for
  // every configured dashboard, including custom roles sharing those routes.
  const js = ts.transpileModule(await readFile('src/lib/rbac.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { DASHBOARDS, landingPath, visibleNav } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  for (const d of DASHBOARDS) {
    const user = { roleKind: 'staff', dashboard: d.id, permissions: ['dashboard.staff', ...(d.needs ? [d.needs] : [])] };
    assert.equal(landingPath(user), d.href);
    if (d.needs) assert.equal(landingPath({ ...user, permissions: ['dashboard.staff'] }), '/staff');
  }
  assert.equal(visibleNav({ permissions: ['dashboard.staff'] }, [{ label: 'Finance', href: '/staff/finance', icon: 'account_balance', permission: 'finance.view' }]).length, 0);
  console.log('PASS all dashboard destination mappings, permission fallbacks, restricted fixture states and signed-out route guards');
} finally {
  await browser.close();
}
