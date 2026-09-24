/** Record a correctly-categorised expense, then approve it as the manager. */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';
const browser = await openBrowser();

{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.ACC, process.env.PW);
  await page.goto(`${BASE}/staff/finance/new/expense`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.selectOption('#expense-category', { label: 'Office supplies' });
  await page.fill('#expense-amount', '85000');
  await page.fill('#expense-description', 'Stationery and receipt books for the front desk');
  await page.fill('#expense-payee', 'Mayuge Stationers');
  await page.fill('#expense-ref', 'INV-2026-0915');
  await settle(page, 400);
  await shot(page, 'staff', 'expense-02-filled');
  await page.locator('main button', { hasText: 'Review' }).last().click();
  await settle(page, 800);
  await shot(page, 'staff', 'expense-03-confirm');
  await page.locator('button', { hasText: /Record|Confirm|Submit/ }).last().click();
  await settle(page, 2500);
  await shot(page, 'staff', 'expense-04-result');
  console.log('recorded:', (await page.locator('main').innerText()).slice(0, 160).replace(/\n+/g, ' / '));
  await context.close();
}

{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.MGR, process.env.PW);
  await page.goto(`${BASE}/staff/finance/expenses`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.locator('main button', { hasText: 'Awaiting approval' }).first().click().catch(() => {});
  await settle(page, 1200);
  await shot(page, 'staff', 'expense-05-awaiting-approval');
  const cardButtons = await page.evaluate(() => Array.from(document.querySelectorAll('main a, main button')).map(b => `${b.tagName}:${(b.getAttribute('href')||'')}:${b.innerText.replace(/\s+/g,' ').trim().slice(0,30)}`).filter(x => x.includes('EXP') || /Approve|Reject|View/i.test(x)));
  console.log('card controls:', cardButtons.join(' | '));
  const approve = page.locator('main button', { hasText: 'Approve' }).first();
  if (await approve.count()) {
    await approve.scrollIntoViewIfNeeded();
    await approve.click();
    await settle(page, 900);
    await shot(page, 'staff', 'expense-06-approve-dialog');
    await page.locator('[role="dialog"] button, dialog button').filter({ hasText: /Approve|Confirm/ }).last().click();
    await settle(page, 2500);
    await shot(page, 'staff', 'expense-07-approved');
    console.log('after approve:', (await page.locator('main').innerText()).slice(0, 200).replace(/\n+/g, ' / '));
  } else {
    console.log('no Approve button on the list');
  }
  await context.close();
}
await browser.close();
