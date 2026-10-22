/**
 * Money formatting, on the source the application actually ships.
 *
 *   npm run test:money
 *
 * WHY THIS READS src/lib/money.ts RATHER THAN A COPY
 *
 * This suite used to import `/var/tmp/bud-docs-stack/money-extract.mjs` - an
 * absolute path to a hand-made JavaScript copy of two functions from
 * `src/lib/money.ts`, left behind by whoever last ran the local test stack. It
 * had two problems, and only the first one broke CI:
 *
 *  1. The path does not exist anywhere but the machine that generated it, so
 *     the suite could not run on a fresh checkout or on a CI runner.
 *  2. More seriously, it tested a *duplicate*. The copy happened to match
 *     `src/lib/money.ts` when it was written, and nothing kept it matching. A
 *     change to the application's money formatting would have left this suite
 *     passing against the old behaviour - a test that cannot fail when the
 *     thing it guards breaks, which is the same fault the audit recorded as
 *     F-14 in a different corner of the system.
 *
 * So it now transpiles `src/lib/money.ts` with the repository's own TypeScript
 * dependency and runs the result, exactly as `scripts/phone.test.mjs` has
 * always done for `src/lib/phone.ts`. No generated file, no absolute path,
 * nothing to keep in step by hand: if the application's formatting changes,
 * this suite sees the change.
 *
 * Every one of the 22 assertions from the previous version is preserved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Resolved from this file, so the suite runs from any working directory.
const source = new URL('../src/lib/money.ts', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
// Same realm as the test, so Intl objects and numbers compare as themselves.
vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n })`)(
  createRequire(source),
  module,
  module.exports,
);
const { groupDigits, ungroupDigits } = module.exports;

test('the suite is exercising the application module, not a copy', () => {
  assert.equal(typeof groupDigits, 'function', 'groupDigits was not exported by src/lib/money.ts');
  assert.equal(typeof ungroupDigits, 'function', 'ungroupDigits was not exported by src/lib/money.ts');
});

/**
 * What somebody types, what the field should show, and what the form should
 * post. The first row is finding V-2 from the earlier QA round.
 */
const cases = [
  // [typed or supplied, expected display, expected posted value]
  ['196666.67', '196,666.67', '196666.67'], // the V-2 case
  ['536666.65', '536,666.65', '536666.65'], // a fractional full balance
  ['2360000', '2,360,000', '2360000'], // a whole amount
  ['100000', '100,000', '100000'],
  ['0', '0', '0'],
  ['', '', ''],
  ['1200.', '1,200.', '1200'], // mid-typing
  ['1200.5', '1,200.5', '1200.5'],
  ['1200.567', '1,200.56', '1200.56'], // cents are capped at two
  ['1,200,000', '1,200,000', '1200000'], // already grouped
  ['.5', '0.5', '0.5'],
  ['88333.33', '88,333.33', '88333.33'],
  ['abc', '', ''],
  ['12ab34', '1,234', '1234'],
];

for (const [input, wantDisplay, wantValue] of cases) {
  test(`typing ${JSON.stringify(input)} displays ${JSON.stringify(wantDisplay)} and posts ${JSON.stringify(wantValue)}`, () => {
    const display = groupDigits(input);
    assert.equal(display, wantDisplay);
    assert.equal(ungroupDigits(display), wantValue);
  });
}

/**
 * A value the system supplies must survive being displayed and come back
 * exactly equal. A shilling that changes on the way through a form is the
 * whole reason this suite exists.
 */
for (const n of [196666.67, 536666.65, 88333.33, 2360000, 0.02, 76666.67, 1, 99999999.99]) {
  test(`${n} round-trips through display unchanged`, () => {
    assert.equal(Number(ungroupDigits(groupDigits(String(n)))), n);
  });
}
