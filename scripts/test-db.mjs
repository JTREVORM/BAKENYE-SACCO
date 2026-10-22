/**
 * Run the SQL test suites in `supabase/tests/` against the project database.
 *
 *   npm run test:db
 *
 * Each suite runs inside a transaction that is always rolled back, as the
 * signed-in identity of a real super administrator, so it exercises the same
 * `auth.uid()` / role checks the application hits. Nothing it writes survives.
 *
 * A suite reports by selecting `(step, ok, detail)` rows; any `ok = false` row
 * fails the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local.');
  process.exit(1);
}

// Supabase requires TLS; a local Postgres for development or a clean-install
// test does not offer it. PGSSLMODE=disable is the standard way to say so.
const SSL = process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false };

const dir = 'supabase/tests';
const suites = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  : [];

if (suites.length === 0) {
  console.error(`No suites found in ${dir}.`);
  process.exit(1);
}

/**
 * Suites that must run, and must produce assertions, or this is a failed run.
 *
 * F-13/F-14: the danger is not a suite that fails, it is a suite that does not
 * run and is counted as a pass. A renamed file, a syntax error swallowed
 * somewhere, an empty result set - each of those used to leave the run green
 * with nothing having been checked. These are named explicitly so that losing
 * one is loud. Security suites first, because they are the ones whose silent
 * absence let F-01 survive a prior certification.
 */
const REQUIRED_SUITES = [
  'password_security_test.sql',
  'members_access_test.sql',
  'rls_isolation_test.sql',
  'treasury_test.sql',
  'business_rules_2026_test.sql',
];

const missing = REQUIRED_SUITES.filter((s) => !suites.includes(s));
if (missing.length > 0) {
  console.error(`Required suite(s) not found in ${dir}: ${missing.join(', ')}`);
  console.error('A security suite that does not run must never be reported as a pass.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: SSL,
  statement_timeout: 300_000,
});
await client.connect();

let failed = 0;
let passed = 0;
/** Assertions seen per suite, so a suite that ran but checked nothing is caught. */
const assertionsBySuite = new Map();

try {
  const { rows: admins } = await client.query(
    "select id, full_name from app_users where role = 'super_admin' and is_active limit 1",
  );
  if (admins.length === 0) {
    console.error('No active super_admin found. Create one before running the suites.');
    process.exit(1);
  }

  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: admins[0].id, role: 'authenticated' }),
  ]);
  await client.query('set role authenticated');

  console.log(`Running as ${admins[0].full_name} (super_admin)\n`);

  for (const suite of suites) {
    console.log(`── ${suite}`);
    const sql = fs.readFileSync(path.join(dir, suite), 'utf8');
    let results;
    try {
      const out = await client.query(sql);
      const sets = Array.isArray(out) ? out : [out];
      results = sets.reverse().find((r) => r.fields?.some((f) => f.name === 'step'))?.rows ?? [];
    } catch (error) {
      console.error(`   ✖ suite errored: ${error.message}`);
      await client.query('rollback').catch(() => {});
      failed += 1;
      continue;
    }

    assertionsBySuite.set(suite, results.length);
    for (const row of results) {
      const ok = row.ok === true || row.result === 'PASS';
      if (ok) passed += 1;
      else failed += 1;
      console.log(`   ${ok ? '✔' : '✖'} ${row.step}${row.detail ? ` — ${row.detail}` : ''}`);
    }
    if (results.length === 0) {
      console.log('   ✖ this suite produced no assertions');
      failed += 1;
    }
    console.log('');
  }
} finally {
  await client.end();
}

// A required suite that ran but asserted nothing is a failure, not a pass.
for (const suite of REQUIRED_SUITES) {
  const n = assertionsBySuite.get(suite);
  if (n === undefined) {
    console.error(`✖ required suite ${suite} did not run`);
    failed += 1;
  } else if (n === 0) {
    console.error(`✖ required suite ${suite} produced no assertions`);
    failed += 1;
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
