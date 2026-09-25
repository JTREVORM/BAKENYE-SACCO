/**
 * Capture the four-step member registration wizard, as a Manager, and register
 * one additional demonstration member.
 *
 * There used to be a categories step between the member's details and the
 * fees. Savings are open and every share costs the same, so there is nothing to
 * choose and the step is gone.
 */
import { openBrowser, newPage, signIn, settle, shot, BASE } from './lib.mjs';

const browser = await openBrowser();
const { page } = await newPage(browser);
await signIn(page, process.env.ID, process.env.PW);

await page.goto(`${BASE}/staff/members/new`, { waitUntil: 'domcontentloaded' });
await settle(page);
await shot(page, 'staff', 'register-01-step1-empty');

await page.fill('#full_name', 'Esther Namukasa');
await page.fill('#phone', '0772100013');
await page.fill('#national_id', 'CM90000013XY');
await page.fill('#date_of_birth', '1992-04-18');
await page.selectOption('#gender', 'female').catch(() => {});
await page.fill('#address', 'Bugungumale Trading Centre, Mayuge District');
await page.fill('#occupation', 'Produce trader');
await page.fill('#next_of_kin_name', 'Paul Namukasa');
await page.fill('#next_of_kin_relation', 'Spouse');
await page.fill('#next_of_kin_phone', '0782100013');
await settle(page, 400);
await shot(page, 'staff', 'register-02-step1-filled');

const next = () => page.locator('button', { hasText: 'Continue' }).last();
async function advance(name) {
  const btn = next();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await settle(page, 900);
  await shot(page, 'staff', name);
  console.log('  ->', (await page.locator('main h2, main h1').first().innerText()).slice(0, 60));
}

await advance('register-05-step3-fees');    // step 2 of 4: the fees
await advance('register-06-step4-payment');  // step 3 of 4: payment

// Step 3 - take the fees in cash (radio 0/1 = paying now/later, 2 = Cash)
const payRadios = page.locator('main input[type="radio"]');
console.log('payment radios:', await payRadios.count());
await payRadios.nth(2).click({ force: true });
await settle(page, 400);
// Amount received is the only free-text money field on this step.
const amount = page.locator('main input[inputmode="numeric"], main input[type="text"]').last();
await amount.fill('20000');
await settle(page, 500);
await shot(page, 'staff', 'register-07-step4-filled');

await advance('register-08-step5-confirm');  // step 4 of 4: confirm

const finish = page.locator('button', { hasText: 'Register member' }).last();
await finish.scrollIntoViewIfNeeded();
await finish.click();
await settle(page, 3000);
await shot(page, 'staff', 'register-09-result');
console.log('final url:', page.url());
console.log('result:', (await page.locator('main').innerText()).slice(0, 300).replace(/\n+/g, ' / '));
await browser.close();
