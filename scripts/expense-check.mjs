/**
 * Expense form and display checks against a disposable LOCAL development stack.
 *
 * STAFF_EMAIL=... STAFF_PASSWORD=... CHROME_PATH=... node scripts/expense-check.mjs [url]
 * DATABASE_URL is read from the environment or .env.local. Requires a supervisor
 * with finance approval permission and four-eyes disabled in this test database.
 * Creates one UGX 1 expense through the UI, approves it, checks receipts/exports,
 * then reverses it in finally. Audit/expense history is retained; no rows are deleted.
 * SQL suites cover invalid requests, historical records and four-eyes separately.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import pg from 'pg';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const BASE = process.argv[2] ?? 'http://localhost:3000';
const local = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
assert(local(new URL(BASE).hostname) && process.env.DATABASE_URL && local(new URL(process.env.DATABASE_URL).hostname),
  'Run expense-check only against a disposable localhost application and database.');
assert(process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD, 'Set staff credentials without putting them in this file.');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const marker = `Expense browser test ${randomUUID()}`;
let accountId;
let balanceBefore;
let checks = 0;
function pass(label) { checks += 1; console.log(`PASS ${label}`); }
const additions = ['Stationery', 'Printing & Photocopying', 'Registration Fees', 'Permits & Licences'];
const categoriesBefore = Number((await db.query('select count(*) from expense_categories')).rows[0].count);

try {
  assert.equal((await db.query("select setting_bool('treasury.four_eyes') as enabled")).rows[0].enabled, false,
    'This browser workflow requires self-approval enabled in the disposable database.');
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('[name=identifier]', process.env.STAFF_EMAIL);
  await page.fill('[name=password]', process.env.STAFF_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname.startsWith('/staff/'), { timeout: 30000 });

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/staff/finance/new/expense`, { waitUntil: 'networkidle' });
    const select = page.locator('[name=category_id]');
    const names = await select.locator('option').allTextContents();
    for (const name of [...additions, 'Salaries', 'Rent', 'Electricity', 'Internet', 'Transport', 'Office supplies', 'Bank charges', 'Equipment', 'Other']) {
      assert(names.some((n) => n.trim() === name), `Missing category ${name}`);
    }
    pass(`${width}px: original and new categories are available`);
    assert.equal(await page.locator('[name=custom_expense]').count(), 0);
    await select.selectOption({ label: 'Other' });
    const custom = page.getByLabel(/Specify expense/);
    assert.equal(await custom.getAttribute('placeholder'), 'Enter the expense type or description');
    assert.equal(await custom.getAttribute('required'), '');
    assert.equal(await custom.getAttribute('maxlength'), '160');
    pass(`${width}px: Other reveals the required field with the requested placeholder`);
    await page.fill('#expense-amount', '1');
    await page.fill('#expense-description', marker);
    const review = page.getByRole('button', { name: 'Review', exact: true });
    assert(await review.isDisabled());
    await custom.fill(' \t ');
    assert(await review.isDisabled());
    pass(`${width}px: blank and whitespace-only Other cannot be reviewed`);
    await custom.fill('  Office cleaning  ');
    assert(await review.isEnabled());
    await review.click();
    assert(await page.getByText('Other — Office cleaning', { exact: true }).isVisible());
    pass(`${width}px: confirmation shows the trimmed custom expense`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await select.selectOption({ label: 'Stationery' });
    assert.equal(await page.locator('[name=custom_expense]').count(), 0);
    assert.equal(await page.locator('form').filter({ has: page.locator('[name=idempotency_key]') })
      .evaluate((f) => new FormData(f).has('custom_expense')), false);
    await select.selectOption({ label: 'Other' });
    assert.equal(await custom.inputValue(), '');
    pass(`${width}px: changing category removes the field and clears the custom value`);
  }

  const custom = page.locator('[name=custom_expense]');
  await custom.fill('Office cleaning');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  // Bypass the client gate deliberately: the last submitted value is blank.
  await page.locator('form').filter({ has: page.locator('[name=idempotency_key]') }).evaluate((f) => {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = 'custom_expense'; input.value = '   ';
    input.dataset.invalidExpenseTest = 'true'; f.appendChild(input);
  });
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await page.getByText('Specify expense when choosing Other.', { exact: true }).waitFor();
  assert.equal((await db.query('select count(*) from expense_entries where description=$1', [marker])).rows[0].count, '0');
  pass('server rejects whitespace-only Other even when the client gate is bypassed');

  await page.goto(`${BASE}/staff/finance/new/expense`, { waitUntil: 'networkidle' });
  await page.locator('[name=category_id]').selectOption({ label: 'Other' });
  await page.fill('[name=custom_expense]', '  Office cleaning  ');
  await page.fill('#expense-amount', '1');
  await page.fill('#expense-description', marker);
  accountId = await page.locator('[name=payment_account_id]').inputValue();
  balanceBefore = Number((await db.query('select balance from financial_account_balances where id=$1', [accountId])).rows[0].balance);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await page.getByRole('heading', { name: 'Submitted for approval', exact: true }).waitFor();
  const expense = (await db.query('select * from expense_entries where description=$1', [marker])).rows[0];
  assert(expense);
  assert.equal(expense.custom_expense, 'Office cleaning');
  assert.equal(expense.approval, 'pending');
  assert.equal(Number((await db.query('select balance from financial_account_balances where id=$1', [accountId])).rows[0].balance), balanceBefore);
  pass('submission saves the trimmed custom type and waits for approval without posting money');

  await page.goto(`${BASE}/staff/finance/expenses?category=Other&q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' });
  for (const name of additions) assert(await page.getByRole('button', { name, exact: true }).isVisible());
  assert.equal(await page.getByRole('button', { name: 'Other', exact: true }).getAttribute('aria-pressed'), 'true');
  const card = page.locator('li').filter({ hasText: marker });
  assert(await card.getByText(/Other — Office cleaning/).count());
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export CSV/ }).click();
  const csv = await readFile(await (await downloadPromise).path(), 'utf8');
  assert(csv.includes('Other,Other — Office cleaning'));
  pass('Other filter, approval list and CSV retain both the main and custom expense category');
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await card.getByRole('button', { name: /^Approve UGX/ }).click();
  await page.getByText('Expense approved.', { exact: true }).waitFor();
  const approved = (await db.query('select transaction_id, approval from expense_entries where id=$1', [expense.id])).rows[0];
  assert.equal(approved.approval, 'approved');
  assert.equal(Number((await db.query('select balance from financial_account_balances where id=$1', [accountId])).rows[0].balance), balanceBefore - 1);
  pass('existing approval workflow posts exactly the expense amount');
  await page.goto(`${BASE}/staff/transactions/${approved.transaction_id}`, { waitUntil: 'networkidle' });
  assert(await page.getByText('Other — Office cleaning', { exact: true }).isVisible());
  pass('receipt and transaction details display Other — Office cleaning');
  await page.goto(`${BASE}/staff/transactions?q=${expense.payment_no}`, { waitUntil: 'networkidle' });
  assert(await page.getByRole('heading', { name: 'Other — Office cleaning', exact: true }).isVisible());
  pass('transaction list displays the specified expense');
  await page.goto(`${BASE}/staff/finance/ledger?q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' });
  assert(await page.getByText('Other — Office cleaning', { exact: true })
    .evaluateAll((els) => els.some((el) => el.getClientRects().length > 0)));
  pass('account ledger displays the custom type at desktop width');
  await page.goto(`${BASE}/staff/finance/reports?view=statement&account=${accountId}`, { waitUntil: 'networkidle' });
  const statementDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export CSV/ }).click();
  const statementCsv = await readFile(await (await statementDownload).path(), 'utf8');
  assert(statementCsv.includes('Other,Other — Office cleaning'));
  pass('account statement report exports the main and custom type separately');
  await page.goto(`${BASE}/staff/finance/income-expenses?tab=expenses`, { waitUntil: 'networkidle' });
  assert(await page.locator('li').filter({ hasText: marker }).getByText('Other — Office cleaning', { exact: true }).isVisible());
  pass('income and expense approval/report screen displays the specified type');
} finally {
  try {
    const { rows } = await db.query('select id, recorded_by, approval, transaction_id from expense_entries where description=$1', [marker]);
    for (const row of rows) {
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: row.recorded_by, role: 'authenticated' })]);
      await db.query('set role authenticated');
      if (row.approval === 'approved') await db.query('select reverse_transaction($1,$2)', [row.transaction_id, 'Expense browser test cleanup']);
      else if (row.approval === 'pending') await db.query('select approve_expense($1,false,$2)', [row.id, 'Expense browser test cleanup']);
      await db.query('reset role');
    }
    if (accountId && balanceBefore !== undefined) assert.equal(Number((await db.query('select balance from financial_account_balances where id=$1', [accountId])).rows[0].balance), balanceBefore);
    assert.equal(Number((await db.query('select count(*) from expense_categories')).rows[0].count), categoriesBefore);
  } finally {
    await browser.close();
    await db.end();
  }
}
console.log(`${checks} expense browser checks passed; the test payment was reversed and category count is unchanged.`);
