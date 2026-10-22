/**
 * Browser check for temporary passwords and the forced first change.
 *
 *   node scripts/temp-password-check.mjs [baseUrl]
 *
 * As a staff account with 'Edit member records' (STAFF_EMAIL/STAFF_PASSWORD),
 * it resets MEMBER_NO's password from the member's page and reads the
 * temporary password shown once. It then signs in as the member with it and
 * checks that:
 *
 *   - they land on "Choose your password", and every other page sends them back;
 *   - through the REST API, the temporary password opens no records;
 *   - after choosing a password they land on their own dashboard, and the new
 *     password works for the next sign-in.
 *
 * Finally it resets the member's password once more, so the password this
 * script chose does not stay valid: the member is left on a temporary password
 * nobody has seen, and needs a reset from the office to sign in.
 *
 * This changes that member's password. Run it only against an account the
 * SACCO has agreed to use for testing.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.argv[2] ?? 'http://localhost:3000';
const STAFF_EMAIL = process.env.STAFF_EMAIL;
const STAFF_PASSWORD = process.env.STAFF_PASSWORD;
if (!STAFF_EMAIL || !STAFF_PASSWORD) { console.error('Set STAFF_EMAIL and STAFF_PASSWORD to a staff account to test with.'); process.exit(1); }
const MEMBER_NO = process.env.MEMBER_NO ?? 'BND26001';
const CHOSEN = `Chosen${Math.floor(Math.random() * 9000 + 1000)}x`;

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
let failures = 0;
const ok = (pass, text) => {
  if (!pass) failures += 1;
  console.log(`${pass ? '✔' : '✖'} ${text}`);
};

async function signIn(page, identifier, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.fill('input[name="identifier"]', identifier);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 }).catch(() => {});
  return new URL(page.url()).pathname;
}

/** As staff: open the member's page and reset their password; return the temporary one. */
async function resetFromMemberPage(staff) {
  await staff.goto(`${BASE}/staff/members?q=${encodeURIComponent(MEMBER_NO)}`, { waitUntil: 'load' });
  // The list renders a card on phones and a table row on desktop; read the
  // link rather than clicking whichever copy happens to be visible.
  const href = await staff
    .locator('a[href^="/staff/members/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')).find((h) => /\/staff\/members\/[0-9a-f-]{36}$/.test(h ?? '')));
  if (!href) throw new Error(`No member found for ${MEMBER_NO}`);
  await staff.goto(`${BASE}${href}`, { waitUntil: 'load' });
  await staff.locator('button:has-text("Reset password")').first().click();
  await staff.locator('dialog button[type="submit"]:has-text("Reset password")').click();
  const card = staff.locator('text=Temporary password - shown only now');
  await card.waitFor({ timeout: 45_000 });
  const pw = (await staff.locator('p[aria-label^="Temporary password"]').innerText()).trim();
  await staff.locator('button:has-text("Done - I have given it to them")').click();
  return pw;
}

const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const staff = await staffCtx.newPage();
ok((await signIn(staff, STAFF_EMAIL, STAFF_PASSWORD)).startsWith('/staff'), 'staff signed in');

const temp = await resetFromMemberPage(staff);
ok(/^[A-Z]{4}-\d{4}$/.test(temp), `a temporary password was generated and shown once (${temp.replace(/\w/g, '•')})`);

// ---- The member, on the temporary password -------------------------------
const mctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
const m = await mctx.newPage();
const landed = await signIn(m, MEMBER_NO, temp);
ok(landed === '/change-password', `signing in with it goes straight to "Choose your password" (${landed})`);
await m.screenshot({ path: 'screenshots/access/change-password-390.png', fullPage: true });

for (const route of ['/', '/savings', '/profile', '/loans', '/staff', '/admin']) {
  await m.goto(`${BASE}${route}`, { waitUntil: 'load' });
  await m.waitForURL((u) => u.pathname === '/change-password', { timeout: 15_000 }).catch(() => {});
  ok(new URL(m.url()).pathname === '/change-password', `on a temporary password, ${route} sends them back to choose a password`);
}

// The same temporary password, straight at the REST API.
const { data: acct } = await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}).rpc('login_resolve', { p_identifier: MEMBER_NO, p_client: 'temp-password-check' });
const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { error: apiErr } = await api.auth.signInWithPassword({ email: acct.candidates[0].auth_email, password: temp });
const { data: rows } = await api.from('members').select('id');
const { data: sess } = await api.rpc('my_session');
ok(!apiErr && (rows ?? []).length === 0 && sess?.must_change_password === true,
  `through the REST API the temporary password reads no records (${(rows ?? []).length} rows)`);

// ---- F-01 / BKC-01: try to lift the lock, not merely observe that it holds --
//
// This is the step whose absence let the defect survive a prior certification.
// The check above asserts that a temporary password reads nothing; it never
// tried to *stop* being a temporary password first. `log_password_changed()`
// used to clear `must_change_password` for `auth.uid()` unconditionally, so
// this one call turned a confined session into a fully privileged one while the
// temporary password stayed live.
//
// Every assertion here is about the attempt failing, so this test cannot pass
// while the control is broken.
const bypass = await api.rpc('log_password_changed');
ok(!!bypass.error, `the retired log_password_changed() RPC is refused (${bypass.error?.code ?? 'no error - BYPASS OPEN'})`);

// Whether or not the call was refused, the only thing that matters is whether
// the lock held. Re-read through the same bearer token.
const { data: afterRows } = await api.from('members').select('id');
const { data: afterTxns } = await api.from('transactions').select('id');
const { data: afterSess } = await api.rpc('my_session');
ok(
  (afterRows ?? []).length === 0 &&
    (afterTxns ?? []).length === 0 &&
    afterSess?.must_change_password === true,
  `after the bypass attempt the temporary password still reads nothing (${(afterRows ?? []).length} members, ${(afterTxns ?? []).length} transactions, must_change_password=${afterSess?.must_change_password})`,
);

// The two halves of a real password change are server-only: a member's bearer
// token must not reach either, so neither can be used to clear the flag.
const beg = await api.rpc('begin_password_change', { p_user_id: acct.candidates[0].user_id });
const cmp = await api.rpc('complete_password_change', {
  p_user_id: acct.candidates[0].user_id,
  p_nonce: '00000000-0000-0000-0000-000000000000',
});
ok(
  !!beg.error && !!cmp.error,
  `a member's own token cannot call either half of a verified password change (${beg.error?.code ?? 'OPEN'}/${cmp.error?.code ?? 'OPEN'})`,
);

// And the temporary password is still only a temporary password: it must still
// land on "Choose your password", not on the dashboard.
const stillLocked = await (async () => {
  const probe = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await probe.newPage();
  const where = await signIn(page, MEMBER_NO, temp);
  await probe.close();
  return where;
})();
ok(stillLocked === '/change-password',
  `and signing in with it still goes only to "Choose your password" (${stillLocked})`);

// Only this API client's session - the default would sign the member out
// everywhere, including the browser this check is still driving.
await api.auth.signOut({ scope: 'local' });

// Wrong temporary password in the form, then the right one.
await m.goto(`${BASE}/change-password`, { waitUntil: 'load' });
await m.fill('input[name="current_password"]', 'WRONG-0000');
await m.fill('input[name="password"]', CHOSEN);
await m.fill('input[name="confirm"]', CHOSEN);
await m.click('button[type="submit"]');
await m.waitForSelector('text=Your current password is incorrect', { timeout: 45_000 }).catch(() => {});
ok((await m.locator('text=Your current password is incorrect').count()) > 0, 'a wrong temporary password is refused');

await m.fill('input[name="current_password"]', temp);
await m.fill('input[name="password"]', CHOSEN);
await m.fill('input[name="confirm"]', CHOSEN);
await m.click('button[type="submit"]');
await m.waitForURL((u) => u.pathname !== '/change-password', { timeout: 45_000 }).catch(() => {});
ok(new URL(m.url()).pathname === '/', `after choosing a password the member lands on their dashboard (${new URL(m.url()).pathname})`);

await m.goto(`${BASE}/savings`, { waitUntil: 'load' });
ok(new URL(m.url()).pathname === '/savings', 'and every member page opens');

await m.evaluate(() => fetch('/auth/signout', { method: 'POST' }));
await mctx.clearCookies();
ok((await signIn(m, MEMBER_NO, temp)) === '/login', 'the temporary password no longer works');
ok((await signIn(m, MEMBER_NO, CHOSEN)) === '/', 'their own password does');
await mctx.close();

// ---- Leave no known password behind --------------------------------------
const after = await resetFromMemberPage(staff);
ok(/^[A-Z]{4}-\d{4}$/.test(after), 'reset again at the end: the member is left on a temporary password nobody has seen');
await staffCtx.close();

await browser.close();
console.log(`\n${failures} problem(s)`);
process.exit(failures ? 1 : 0);
