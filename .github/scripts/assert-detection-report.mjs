/**
 * Assert that restoring the F-01 defect produced the *expected security
 * assertion failures* — and not merely some non-zero exit.
 *
 *   node .github/scripts/assert-detection-report.mjs <report.json>
 *
 * WHY THIS EXISTS
 *
 * `ci-verify-detection.sh` re-runs `scripts/password-security-rest-check.mjs`
 * against a throwaway database with the pre-0049 `log_password_changed()` put
 * back, and needs the check to fail. The obvious way to test that is
 * `if [ $? -ne 0 ]`, and that is wrong, dangerously so: a missing module, a
 * refused database connection, a typo in the shell script, an out-of-disk
 * runner — every one of those also exits non-zero, and every one of them would
 * have been recorded as "the check detects the vulnerability". The job would go
 * green while proving nothing.
 *
 * That is not hypothetical. On run 39789916492 the copy of the database could
 * not be created because PostgREST still held sessions on the source, the
 * script died on that, and the only reason it did not count as proof is that
 * `set -e` killed the script before it reached the exit-code test.
 *
 * So detection is asserted by name. The run must have completed, the five
 * assertions the defect breaks must all have failed, and the seven that prove
 * the harness itself worked must all have passed. Anything else — a crash, a
 * connection error, a different set of failures, an assertion that quietly
 * disappeared — fails this job.
 */
import fs from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: assert-detection-report.mjs <report.json>');
  process.exit(1);
}

/**
 * Exactly what restoring F-01 must break.
 *
 * Each of these is a direct consequence of `log_password_changed()` clearing
 * `must_change_password` for `auth.uid()` again: the RPC answers 204 instead of
 * being refused, the lock lifts, the account starts reading records, the flag
 * and timestamp change, and an audit row appears claiming the holder chose
 * their own password.
 */
const MUST_FAIL = [
  'bypass-refused',
  'lock-holds-after',
  'reads-nothing-after',
  'flag-untouched',
  'no-false-audit',
];

/**
 * What must still pass, because it is the evidence the harness worked.
 *
 * If provisioning failed, or the session could not be read, or the lock was
 * never observed holding in the first place, then the five failures above are
 * not a detected vulnerability — they are a broken test environment that
 * happens to produce the same exit code.
 *
 * `credential-untouched` is here deliberately: the bypass must lift the lock
 * *without* changing the password. If the credential had changed too, the run
 * would not be reproducing F-01 at all.
 */
const MUST_PASS = [
  'provisioned',
  'session-locked',
  'lock-holds-before',
  'halves-unreachable',
  'issue-retired',
  'credential-untouched',
  'stores-private',
];

const problems = [];
const fail = (message) => problems.push(message);

if (!fs.existsSync(path)) {
  console.error(
    `✖ no report at ${path}.\n` +
      '  The check did not run, or died before it could write one. That is not\n' +
      '  evidence that it detects the vulnerability.',
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`✖ the report at ${path} is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (report.completed !== true) {
  fail(
    'the check did not run to completion (`completed` is not true), so its ' +
      'failures are a crash rather than a detection',
  );
}

const byId = new Map((report.assertions ?? []).map((a) => [a.id, a]));

for (const id of MUST_FAIL) {
  const a = byId.get(id);
  if (!a) fail(`assertion '${id}' is missing from the run — it must fail, so it must exist`);
  else if (a.pass) fail(`assertion '${id}' PASSED against the restored defect; it must fail — ${a.text}`);
}

for (const id of MUST_PASS) {
  const a = byId.get(id);
  if (!a) fail(`assertion '${id}' is missing from the run — it must pass, so it must exist`);
  else if (!a.pass) {
    fail(
      `assertion '${id}' failed, which means the test environment is broken ` +
        `rather than the vulnerability being detected — ${a.text}`,
    );
  }
}

// Set equality, so an assertion added or removed forces a conscious decision
// here about whether the defect should break it.
const expected = new Set([...MUST_FAIL, ...MUST_PASS]);
for (const id of byId.keys()) {
  if (!expected.has(id)) {
    fail(
      `the run reported an assertion this job does not know about: '${id}'. ` +
        'Decide whether restoring F-01 should break it, and list it in MUST_FAIL or MUST_PASS.',
    );
  }
}

if (report.failures !== MUST_FAIL.length) {
  fail(
    `the run reported ${report.failures} failure(s); exactly ${MUST_FAIL.length} were expected ` +
      `(${MUST_FAIL.join(', ')})`,
  );
}

if (problems.length > 0) {
  console.error('✖ restoring the F-01 defect did not produce the expected security failures:\n');
  for (const p of problems) console.error(`   · ${p}`);
  console.error(
    '\n  A generic crash or a database error is not proof that the check detects\n' +
      '  the vulnerability. Fix whichever is actually wrong: the check, or this\n' +
      '  job\'s expectations.',
  );
  process.exit(1);
}

console.log(
  `✔ restoring F-01 broke exactly the ${MUST_FAIL.length} security assertions it must:\n` +
    MUST_FAIL.map((id) => `   ✖ ${id} — ${byId.get(id).text}`).join('\n'),
);
console.log(
  `\n✔ and the ${MUST_PASS.length} assertions that prove the harness worked all still passed:\n` +
    MUST_PASS.map((id) => `   ✔ ${id}`).join('\n'),
);
console.log('\nThe check can still detect the vulnerability it exists to catch.');
