/**
 * Run a SQL file (or an inline statement) against the project database.
 *
 *   node scripts/db-exec.mjs supabase/migrations/0007_groups.sql
 *   node scripts/db-exec.mjs "select count(*) from members"
 *   node scripts/db-exec.mjs --as <app_user_id> "select savings_dashboard()"
 *
 * Reads `DATABASE_URL` from `.env.local`. This exists because the Supabase CLI
 * needs a linked project and an access token; a migration should be appliable
 * from a plain connection string too.
 *
 * `--as` runs the statement as the `authenticated` role with that user in the
 * JWT claims, which is the only way to exercise RLS and the role checks inside
 * the SECURITY DEFINER functions from a shell.
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

const argv = process.argv.slice(2);
let actAs = null;
const asIndex = argv.indexOf('--as');
if (asIndex !== -1) {
  actAs = argv[asIndex + 1];
  argv.splice(asIndex, 2);
}

const arg = argv[0];
if (!arg) {
  console.error('Usage: node scripts/db-exec.mjs [--as <user_id>] <file.sql | "select 1">');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env.local.');
  process.exit(1);
}

const isFile = fs.existsSync(arg) && fs.statSync(arg).isFile();
const sql = isFile ? fs.readFileSync(arg, 'utf8') : arg;

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 300_000,
});

await client.connect();
try {
  if (actAs) {
    await client.query(
      "select set_config('request.jwt.claims', $1, false), set_config('role', 'authenticated', false)",
      [JSON.stringify({ sub: actAs, role: 'authenticated' })],
    );
    await client.query('set role authenticated');
  }
  const result = await client.query(sql);
  for (const r of Array.isArray(result) ? result : [result]) {
    if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 2));
    else console.log(`${r.command ?? 'OK'}${r.rowCount != null ? ` ${r.rowCount}` : ''}`);
  }
  if (isFile) console.log(`\n✔ applied ${path.basename(arg)}`);
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  if (error.position && !isFile) console.error(`  at character ${error.position}`);
  if (error.where) console.error(`  ${error.where}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
