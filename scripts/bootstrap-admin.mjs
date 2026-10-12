/**
 * Create the FIRST Super Admin of a fresh installation.
 *
 *   npm run bootstrap:admin -- --name "Jane Namara" --phone 0772123456
 *   npm run bootstrap:admin -- --name "Jane Namara" --email jane@example.org
 *
 * There is no default account and no web page that creates one: a sign-up or
 * "first-run" screen on a public URL would hand the SACCO to whoever found it
 * first. This runs on the operator's machine with the service-role key from
 * `.env.local`, and it refuses to run at all once any Super Admin exists -
 * from then on, staff accounts are created in the app under Users.
 *
 * The account gets a generated temporary password, printed once. It is never
 * stored readable (Supabase keeps a bcrypt hash) and must be replaced at the
 * first sign-in, exactly like every other account the SACCO creates.
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? '').trim() || null;
}

function die(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const name = arg('name');
const phone = arg('phone');
const email = arg('email')?.toLowerCase() ?? null;

if (!name || name.length < 3) die('Give the administrator\'s full name: --name "Full Name"');
if (!phone && !email) die('Give a phone number (--phone 07XXXXXXXX) or an email (--email) to sign in with.');
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('That email address is not valid.');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function superAdminCount() {
  const { count, error } = await admin
    .from('app_users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'super_admin');
  if (error) die(`Could not read existing accounts: ${error.message}`);
  return count ?? 0;
}

if ((await superAdminCount()) > 0) {
  die('A Super Admin already exists. Create further accounts in the app under Users.');
}

let normalisedPhone = null;
if (phone) {
  const { data, error } = await admin.rpc('normalize_phone', { p: phone });
  if (error || !data) die('Enter a valid Uganda number or an international number starting with + and its country code.');
  normalisedPhone = data;
}

// Same alphabet as src/lib/accounts.ts: no 0/O or 1/I to misread.
const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const digits = '23456789';
const bytes = randomBytes(8);
let password = '';
for (let i = 0; i < 4; i++) password += letters[bytes[i] % letters.length];
password += '-';
for (let i = 4; i < 8; i++) password += digits[bytes[i] % digits.length];

const { data: created, error } = await admin.auth.admin.createUser({
  email: email ?? `u-${randomBytes(9).toString('hex')}@staff.bnd-sacco.invalid`,
  password,
  email_confirm: true,
  user_metadata: { full_name: name, phone: normalisedPhone },
  app_metadata: { role: 'super_admin' },
});
if (error || !created?.user) die(`The account could not be created: ${error?.message ?? 'unknown error'}`);

// Two operators racing each other: keep only the first.
if ((await superAdminCount()) > 1) {
  await admin.auth.admin.deleteUser(created.user.id);
  die('Another Super Admin was created at the same moment. This one has been removed.');
}

await admin.from('audit_logs').insert({
  actor_id: created.user.id,
  actor_name: 'bootstrap',
  action: 'account.bootstrap_admin',
  module: 'Security',
  record_id: created.user.id,
  summary: `First Super Admin ${name} created from the command line`,
});

console.log('✔ First Super Admin created.\n');
console.log(`  Name:                ${name}`);
console.log(`  Sign in with:        ${normalisedPhone ?? email}`);
console.log(`  Temporary password:  ${password}`);
console.log('\n  This password is shown once. It must be changed at the first sign-in.');
