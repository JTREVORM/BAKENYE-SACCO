/**
 * Capture the loan lifecycle: an application under review, approval,
 * disbursement and a repayment. Real records in the local database.
 */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';

const APPLIED = '56888a32-f431-477d-a141-0766d4a2a768';   // BND26001, applied
const browser = await openBrowser();

// --- Loan officer: assess -------------------------------------------------
{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.LO_ID, process.env.PW);
  await page.goto(`${BASE}/staff/loans-desk`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'staff', 'loan-01-officer-desk');

  await page.goto(`${BASE}/staff/loans/${APPLIED}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'staff', 'loan-02-application');

  await page.click('text=Start review');
  await settle(page, 1200);
  await shot(page, 'staff', 'loan-03-under-review');
  console.log('after review:', (await page.locator('main').innerText()).slice(0, 160).replace(/\n+/g, ' / '));
  await context.close();
}

// --- Manager: approve and disburse ---------------------------------------
{
  const { context, page } = await newPage(browser);
  await signIn(page, process.env.MGR_ID, process.env.PW);
  await page.goto(`${BASE}/staff/loans/${APPLIED}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.click('text=Approve');
  await settle(page, 900);
  await shot(page, 'staff', 'loan-04-approve-dialog');
  const fields = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] input,[role="dialog"] select,[role="dialog"] textarea,dialog input,dialog select,dialog textarea')).map(e => [e.tagName, e.type||'', e.name||'', e.id||''].join('|')));
  console.log('approve dialog:', fields.join(' ; '));
  const confirm = page.locator('[role="dialog"] button, dialog button').filter({ hasText: /Approve|Confirm/ }).last();
  await confirm.click();
  await settle(page, 2000);
  await shot(page, 'staff', 'loan-05-approved');
  const actions = await page.evaluate(() => Array.from(document.querySelectorAll('main button')).map(b => b.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
  console.log('actions now:', actions.join(' | '));
  // --- Disburse ----------------------------------------------------------
  await page.click('text=Disburse funds');
  await settle(page, 900);
  await shot(page, 'staff', 'loan-06-disburse-dialog');
  const dfields = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] input,[role="dialog"] select,[role="dialog"] textarea,dialog input,dialog select,dialog textarea')).map(e => [e.tagName, e.type||'', e.name||'', e.id||''].join('|')));
  console.log('disburse dialog:', dfields.join(' ; '));
  const go = page.locator('[role="dialog"] button, dialog button').filter({ hasText: /Disburse|Confirm/ }).last();
  await go.click();
  await settle(page, 2500);
  await shot(page, 'staff', 'loan-07-disbursed');
  console.log('after disburse:', (await page.locator('main').innerText()).slice(0, 220).replace(/\n+/g, ' / '));

  // --- The repayment screen ---------------------------------------------
  await page.goto(`${BASE}/staff/loans/${APPLIED}/repay`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shot(page, 'staff', 'loan-08-repay-form');
  await context.close();
}

await browser.close();
