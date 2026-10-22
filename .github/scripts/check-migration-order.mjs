/**
 * Migration hygiene, checked rather than assumed.
 *
 *   node .github/scripts/check-migration-order.mjs
 *
 * The migration set is cumulative and applied in filename order, so the
 * filenames are load-bearing. Two migrations sharing a number, or a gap that
 * hides a file somebody forgot to commit, would change what a clean install
 * produces - and the audit's F-01 inference rested on the chain being
 * deterministic. This asserts that it is.
 *
 * It checks only names and sequence. What the migrations *do* is covered by
 * the clean-install step and the SQL suites.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = 'supabase/migrations';
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let problems = 0;
const fail = (message) => {
  problems += 1;
  console.error(`✖ ${message}`);
};

if (files.length === 0) fail(`no migrations found in ${dir}`);

const seen = new Map();
for (const file of files) {
  const match = file.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
  if (!match) {
    fail(`${file} is not named NNNN_lower_snake_case.sql`);
    continue;
  }
  const n = Number(match[1]);
  if (seen.has(n)) fail(`migrations ${seen.get(n)} and ${file} share the number ${match[1]}`);
  seen.set(n, file);
}

const numbers = [...seen.keys()].sort((a, b) => a - b);
if (numbers.length > 0) {
  if (numbers[0] !== 1) fail(`the first migration is ${numbers[0]}, expected 0001`);
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      fail(`gap in the sequence: ${String(numbers[i - 1]).padStart(4, '0')} is followed by ${String(numbers[i]).padStart(4, '0')}`);
    }
  }
}

// Applied in filename order, so byte-order sorting and numeric order must agree.
const numericOrder = numbers.map((n) => seen.get(n));
for (let i = 0; i < files.length; i++) {
  if (files[i] !== numericOrder[i]) {
    fail(`filename order and numeric order disagree at position ${i + 1}: ${files[i]} vs ${numericOrder[i]}`);
    break;
  }
}

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  // A migration that opens a transaction must close it, or the rest of the run
  // executes inside a transaction nobody meant to be in.
  const begins = (sql.match(/^\s*begin\s*;/gim) ?? []).length;
  const ends = (sql.match(/^\s*(commit|rollback)\s*;/gim) ?? []).length;
  if (begins !== ends) {
    fail(`${file} has ${begins} begin; and ${ends} commit;/rollback; - they must balance`);
  }
  if (/^\s*rollback\s*;/im.test(sql)) {
    fail(`${file} contains a rollback; - a migration must not undo itself`);
  }
}

console.log(`${files.length} migrations, ${problems} problem(s)`);
process.exit(problems > 0 ? 1 : 0);
