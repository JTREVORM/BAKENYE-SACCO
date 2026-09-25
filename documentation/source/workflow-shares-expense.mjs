/** Capture a share sale (Cashier) and an expense + approval (Accountant, Manager). */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';
const browser = await openBrowser();

// --- Share sale ----------------------------------------------------------
{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.CASHIER, process.env.PW);
  await page.goto(`${BASE}/staff/shares/sell`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'staff', 'shares-01-sell-form');

  await page.locator('main input[type="search"]').first().fill('BND26006');
  await settle(page, 1500);
  await shot(page, 'staff', 'shares-02-member-found');
  await page.locator('main button, main [role="option"]').filter({ hasText: 'BND26006' }).first().click().catch(() => {});
  await settle(page, 900);

  // Any whole number is allowed; 25 is chosen because 25 x UGX 10,000 is the
  // worked example the SACCO's rules give.
  await page.locator('#quantity').fill('25').catch(() => {});
  await page.selectOption('#method', 'cash').catch(() => {});
  await settle(page, 400);
  await shot(page, 'staff', 'shares-03-filled');

  await page.locator('main button', { hasText: 'Review' }).last().click();
  await settle(page, 800);
  await shot(page, 'staff', 'shares-04-confirm');
  await page.locator('button', { hasText: /Record|Confirm|Sell/ }).last().click();
  await settle(page, 2500);
  await shot(page, 'staff', 'shares-05-result');
  console.log('share sale:', (await page.locator('main').innerText()).slice(0, 200).replace(/\n+/g, ' / '));
  await context.close();
}

// --- Expense -------------------------------------------------------------
{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.ACCOUNTANT, process.env.PW);
  await page.goto(`${BASE}/staff/finance/new/expense`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'staff', 'expense-01-form');

  const cats = await page.locator('#expense-category option').allTextContents();
  console.log('expense categories:', cats.join(' | '));
  await page.selectOption('#expense-category', { index: 1 }).catch(() => {});
  await page.fill('#expense-amount', '85000');
  await page.fill('#expense-description', 'Stationery and receipt books for the front desk');
  await page.fill('#expense-payee', 'Mayuge Stationers');
  await page.fill('#expense-ref', 'INV-2026-0914');
  await settle(page, 400);
  await shot(page, 'staff', 'expense-02-filled');

  await page.locator('main button', { hasText: 'Review' }).last().click();
  await settle(page, 800);
  await shot(page, 'staff', 'expense-03-confirm');
  await page.locator('button', { hasText: /Record|Confirm|Submit/ }).last().click();
  await settle(page, 2500);
  await shot(page, 'staff', 'expense-04-result');
  console.log('expense:', (await page.locator('main').innerText()).slice(0, 220).replace(/\n+/g, ' / '));
  await context.close();
}

// --- Approval by the manager --------------------------------------------
{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.MGR, process.env.PW);
  await page.goto(`${BASE}/staff/finance/expenses`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'staff', 'expense-05-awaiting-approval');
  const actions = await page.evaluate(() => Array.from(document.querySelectorAll('main button')).map(b => b.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
  console.log('expense list actions:', actions.slice(0, 12).join(' | '));
  await context.close();
}

await browser.close();
