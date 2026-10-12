/** LOCAL-only parity check: application validation and SQL must agree globally. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import pg from 'pg';
import { getExampleNumber } from 'libphonenumber-js/max';
const require = createRequire(import.meta.url);
const examples = require('libphonenumber-js/examples.mobile.json');
for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
assert(process.env.DATABASE_URL && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname),
  'Run phone metadata checks against a local test database only.');
const source = new URL('../src/lib/phone.ts', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n })`)(createRequire(source), module, module.exports);
const { normalisePhone } = module.exports;
const generated = execFileSync(process.execPath, ['scripts/generate-phone-validation.mjs'], { encoding: 'utf8' });
const migration = fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => /create\s+or\s+replace\s+function\s+(?:public\.)?valid_e164_phone\b/i
    .test(fs.readFileSync(`supabase/migrations/${f}`, 'utf8')));
assert(migration && fs.readFileSync(`supabase/migrations/${migration}`, 'utf8').includes(generated),
  'Pinned client metadata differs from the latest phone validation migration; add a new migration for metadata updates.');
const candidates = new Set(['+999123456789', '+1416', '+10125550123', '+4402079460958', '+772123456',
  '+3545512345', '+80012345678', '0772123456', '+256700000000']);
let countries = 0;
for (const region of Object.keys(examples)) {
  const number = getExampleNumber(region, examples);
  if (!number?.isValid()) continue;
  countries += 1;
  candidates.add(number.number);
  candidates.add(number.formatInternational());
  candidates.add(number.number.slice(0, -1));
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query('select raw, normalize_phone(raw) as actual from jsonb_to_recordset($1::jsonb) as inputs(raw text)',
    [JSON.stringify([...candidates].map((raw) => ({ raw })))]);
  for (const row of rows) assert.equal(row.actual, normalisePhone(row.raw), `Client/SQL phone mismatch: ${row.raw}`);
  console.log(`${rows.length} client/SQL parity checks passed across ${countries} country examples; pinned metadata matches ${migration}.`);
} finally { await db.end(); }
