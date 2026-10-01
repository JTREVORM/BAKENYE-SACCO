/**
 * Checks for dynamic receiving accounts, against a running application.
 *
 *   STAFF_ID=... STAFF_PASSWORD=... \
 *     [MANAGER_ID=... MANAGER_PASSWORD=...] \
 *     node scripts/receiving-accounts-check.mjs [baseUrl]
 *
 * With a manager's credentials it also configures a new merchant account through
 * the SACCO's own Finance screen and proves a counter screen offers it
 * immediately - and stops offering it the moment it is deactivated - with no
 * change to any code.
 *
 * Two halves:
 *
 *   1. a source audit — no screen may carry its own list of payment methods any
 *      more. This is the check that stops the old pattern creeping back in.
 *   2. the real forms in a browser — every screen that takes money asks
 *      "Payment received into" and offers the SACCO's configured accounts, with
 *      no Mobile Money / Bank Transfer / Cheque option anywhere.
 *
 * It fills forms and reads them. It never submits one, so no money is recorded.
 */
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const B = process.argv[2] ?? 'http://127.0.0.1:3000';
const STAFF = process.env.STAFF_ID;
const STAFF_PW = process.env.STAFF_PASSWORD;
const MANAGER = process.env.MANAGER_ID;
const MANAGER_PW = process.env.MANAGER_PASSWORD;

/** Unique enough that a re-run does not collide with the last one's account. */
const STAMP = Date.now().toString().slice(-6);
const NEW_ACCOUNT = `ZZCHECK MTN Collections ${STAMP}`;
const NEW_CODE = `ZZ${STAMP}`;

const checks = [];
const add = (ok, label, detail = '') => {
  checks.push([ok, label, detail]);
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ========================================================== 1. source audit */
console.log('\n── no screen carries its own list of payment methods');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const SOURCES = walk('src');

/**
 * The thing that was removed: a literal list of payment methods in a component,
 * which is what a selector is built from. A server action may still name the
 * values to validate a field it is given - that is the enum, not a menu - so the
 * audit looks at the UI, which is where the choice used to be offered.
 *
 * `lib/format.ts` keeps the labels a stored method is read back with, and
 * `lib/receiving-accounts.ts` and `finance/forms/fields.tsx` hold the one rule
 * that derives a method from an account. Nothing else may name them in a list.
 */
const ALLOWED = new Set([
  path.join('src', 'lib', 'fixtures.ts'),
  path.join('src', 'lib', 'receiving-accounts.ts'),
  path.join('src', 'components', 'finance', 'forms', 'fields.tsx'),
]);

const METHOD_LIST = /\[[^\]]*['"]mobile_money['"][^\]]*['"]bank_transfer['"][^\]]*\]/s;

let offenders = [];
for (const file of SOURCES.filter((f) => f.endsWith('.tsx'))) {
  if (ALLOWED.has(file)) continue;
  const src = readFileSync(file, 'utf8');
  if (METHOD_LIST.test(src)) offenders.push(file);
}
add(offenders.length === 0, 'no screen builds a list of payment methods',
    offenders.join(', ') || 'none');

// And none renders those labels as options, which is the same failure by
// another route.
const rendered = SOURCES.filter((f) => f.endsWith('.tsx')).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return /<option[^>]*>\s*\{?\s*PAYMENT_METHOD_LABELS/.test(src)
    || /PAYMENT_METHOD_LABELS\[\w+\]\s*\}\s*<\/option>/.test(src);
});
add(rendered.length === 0, 'no screen renders payment-method labels as options',
    rendered.join(', ') || 'none');

// Every form that takes money must read the accounts from the one query.
const MONEY_FORMS = [
  'src/components/forms/RecordSavingsForm.tsx',
  'src/components/forms/BuySharesForm.tsx',
  'src/components/forms/RecordRepaymentForm.tsx',
  'src/components/forms/CashMovementForm.tsx',
  'src/components/collections/RecordCollectionDialog.tsx',
];
for (const form of MONEY_FORMS) {
  const src = readFileSync(form, 'utf8');
  add(/ReceivingAccountFields/.test(src) && /useReceivingAccount/.test(src),
      `${path.basename(form)} uses the one shared receiving-account control`);
}

// And they all post through the one server action.
for (const form of MONEY_FORMS) {
  const src = readFileSync(form, 'utf8');
  add(/recordMemberCollection/.test(src),
      `${path.basename(form)} posts through the one collection action`);
}

const treasury = readFileSync('src/app/actions/treasury.ts', 'utf8');
add(/record_member_collection/.test(treasury) &&
    (treasury.match(/supabase\.rpc\('record_member_collection'/g) ?? []).length === 1,
    'there is exactly one call site for the collection function');

// One query for the eligible accounts: everything else takes them as a prop.
const accountQueries = SOURCES.filter((f) =>
  /\.rpc\(\s*['"]collection_accounts['"]/.test(readFileSync(f, 'utf8')),
);
add(accountQueries.length === 1 && accountQueries[0].endsWith('access-queries.ts'),
    'the account list is read in exactly one place', accountQueries.join(', '));

// And one function names an account, so it reads the same everywhere.
const labellers = SOURCES.filter((f) =>
  /function receivingAccountLabel/.test(readFileSync(f, 'utf8')),
);
add(labellers.length === 1 && labellers[0].endsWith('receiving-accounts.ts'),
    'one function names an account, shared by the counter and the finance screens',
    labellers.join(', '));

/* ====================================================== 2. the real screens */
if (!STAFF || !STAFF_PW) {
  console.log('\n  — browser checks skipped (set STAFF_ID and STAFF_PASSWORD)');
} else {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  );

  async function signedInPage(id, password) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(`${B}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="identifier"]', id);
    await page.fill('input[type="password"]', password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
    return { ctx, page };
  }

  /** The options a counter screen currently offers. */
  async function savingsOptions(page) {
    await page.goto(`${B}/staff/savings/record`, { waitUntil: 'networkidle' });
    return (await page.locator('select[name="account_id"] option').allInnerTexts())
      .map((o) => o.trim());
  }

  const { ctx, page } = await signedInPage(STAFF, STAFF_PW);

  console.log('\n── what the money screens ask for');

  const SCREENS = [
    ['Record Savings', '/staff/savings/record'],
    ['Record Share Purchase', '/staff/shares/sell'],
    ['Record Deposit', '/staff/transactions/cash'],
    ['Record Withdrawal', '/staff/transactions/cash?type=withdrawal'],
    ['Record Collection', '/staff/finance/new/collection'],
    ['Other receipt', '/staff/finance/new/receipt'],
  ];

  for (const [name, url] of SCREENS) {
    const res = await page.goto(`${B}${url}`, { waitUntil: 'networkidle', timeout: 60000 });
    if (res?.status() !== 200) {
      add(false, `${name}: the page loads`, String(res?.status()));
      continue;
    }
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const outgoing = /withdrawal/i.test(url);

    add(outgoing ? /Paid out of/.test(body) : /Payment received into|Received into/.test(body),
        `${name}: asks where the money goes, not "Payment method"`,
        /Payment method/.test(body) ? 'still says "Payment method"' : '');
    add(!/Payment method/.test(body), `${name}: the words "Payment method" are gone`);

    // Whatever selector names the account must offer the configured accounts and
    // nothing that looks like a method.
    const options = await page.locator('select[name="account_id"] option').allInnerTexts();
    add(options.length > 0, `${name}: the account selector is populated`,
        options.map((o) => o.trim()).join(' | '));
    add(options.some((o) => /Cash/i.test(o)), `${name}: cash is offered`);
    add(options.some((o) => /Airtel/i.test(o)), `${name}: the Airtel merchant account is offered`);
    add(options.some((o) => /4455667/.test(o)),
        `${name}: the Airtel account is named by its merchant code`);
    add(!options.some((o) => /^\s*(Mobile Money|Bank Transfer|Cheque)\s*$/i.test(o)),
        `${name}: no bare "Mobile Money", "Bank Transfer" or "Cheque" option`);
    // ZZCHECK accounts are this script's own, created further down to prove a
    // new account appears; they are not part of the SACCO's configuration.
    add(!options.some((o) => /MTN/i.test(o) && !/ZZCHECK|ZZ\d{6}/.test(o)),
        `${name}: no MTN merchant account, because none is configured`,
        options.filter((o) => /MTN/i.test(o)).join(' | '));
    add(!options.some((o) => /Demo Bank|Bank Account/i.test(o)),
        `${name}: the deactivated bank account is not offered`);
    // The method travels, derived, as a hidden field the operator never sets.
    const hidden = await page.locator('input[type="hidden"][name="method"]').count();
    add(hidden === 1, `${name}: the payment method rides along derived, not chosen`,
        `${hidden} hidden field(s)`);
  }

  console.log('\n── a loan repayment, which is money in like any other');
  const loanId = await page.evaluate(async () => {
    const res = await fetch('/staff/loans?status=active', { headers: { accept: 'text/html' } });
    const html = await res.text();
    const ids = [...html.matchAll(/\/staff\/loans\/([0-9a-f-]{36})/g)].map((m) => m[1]);
    return [...new Set(ids)][0] ?? null;
  });
  if (loanId) {
    const res = await page.goto(`${B}/staff/loans/${loanId}/repay`, { waitUntil: 'networkidle' });
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (res?.status() === 200 && /Payment received into/.test(body)) {
      const options = await page.locator('select[name="account_id"] option').allInnerTexts();
      add(true, 'Record Repayment: asks "Payment received into"');
      add(options.some((o) => /Airtel/i.test(o)) && !/Payment method/.test(body),
          'Record Repayment: offers the same accounts and no method list',
          options.map((o) => o.trim()).join(' | '));
    } else {
      add(/cannot take a repayment/i.test(body),
          'Record Repayment: no repayable loan in this database, which the page says plainly');
    }
  } else {
    console.log('  — no loan found to open');
  }

  console.log('\n── a newly configured account appears with no code change');

  if (MANAGER && MANAGER_PW) {
    const before = await savingsOptions(page);
    add(!before.some((o) => new RegExp(NEW_CODE).test(o)),
        'the account about to be created is not offered yet');

    const mgr = await signedInPage(MANAGER, MANAGER_PW);
    await mgr.page.goto(`${B}/staff/finance/accounts`, { waitUntil: 'networkidle' });
    // The SACCO's own screen, filled in as a manager would fill it in.
    await mgr.page.getByRole('button', { name: /^Add$/ }).first().click();
    await mgr.page.locator('#acct-name').waitFor({ state: 'visible', timeout: 10000 });
    await mgr.page.locator('#acct-type').selectOption('merchant').catch(() => {});
    await mgr.page.fill('#acct-name', NEW_ACCOUNT);
    await mgr.page.fill('#acct-provider', 'MTN');
    await mgr.page.fill('#acct-merchant-code', NEW_CODE);
    await mgr.page.getByRole('button', { name: /^Create account$/ }).first().click();
    await mgr.page.waitForTimeout(2000);
    await mgr.page.getByRole('button', { name: /^Close$/ }).first().click().catch(() => {});
    await mgr.page.goto(`${B}/staff/finance/accounts`, { waitUntil: 'networkidle' });
    const listed = (await mgr.page.locator('body').innerText()).includes(NEW_ACCOUNT);
    add(listed, 'a manager configures an MTN merchant account under Finance → Accounts',
        listed ? NEW_ACCOUNT : 'not listed');

    if (listed) {
      const after = await savingsOptions(page);
      add(after.some((o) => o.includes(NEW_CODE)),
          'the counter screen offers it at once, with no code change',
          after.join(' | '));
      add(after.some((o) => /MTN Merchant/.test(o)),
          'and names it as an MTN merchant account');
      add(after.length === before.length + 1,
          'nothing else in the list changed', `${before.length} → ${after.length}`);

      // Deactivate it: gone from new receipts, and the history it would have is
      // covered by the SQL suite.
      await mgr.page.goto(`${B}/staff/finance/accounts`, { waitUntil: 'networkidle' });
      const row = mgr.page.locator('li').filter({ hasText: NEW_ACCOUNT }).first();
      await row.getByRole('button', { name: /^Status$/ }).click().catch(() => {});
      await mgr.page.locator('#acct-status').waitFor({ timeout: 8000 }).catch(() => {});
      if (await mgr.page.locator('#acct-status').count()) {
        await mgr.page.locator('#acct-status').selectOption('inactive').catch(() => {});
        await mgr.page.fill('#acct-status-reason', 'Automated check: removing the test account.');
        await mgr.page.getByRole('button', { name: /^(Save|Change status|Update)/i }).last().click();
        await mgr.page.waitForTimeout(2000);
        const afterOff = await savingsOptions(page);
        add(!afterOff.some((o) => o.includes(NEW_CODE)),
            'deactivating it removes it from new collections at once', afterOff.join(' | '));
      } else {
        add(false, 'the status control could not be opened to deactivate the test account');
      }
    }
    await mgr.ctx.close();
  } else {
    console.log('  — skipped (set MANAGER_ID and MANAGER_PASSWORD)');
  }

  await ctx.close();
  await browser.close();
}

const failed = checks.filter(([ok]) => !ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
