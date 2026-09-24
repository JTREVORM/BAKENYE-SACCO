// Unit checks for the money helpers, on the exact source the app uses.
import { readFileSync } from 'node:fs';


const mod = await import('/var/tmp/bud-docs-stack/money-extract.mjs');
const { groupDigits, ungroupDigits } = mod;

const cases = [
  // [typed or supplied, expected display, expected posted value]
  ['196666.67',   '196,666.67', '196666.67'],   // the V-2 case
  ['536666.65',   '536,666.65', '536666.65'],   // a fractional full balance
  ['2360000',     '2,360,000',  '2360000'],     // a whole amount
  ['100000',      '100,000',    '100000'],
  ['0',           '0',          '0'],
  ['',            '',           ''],
  ['1200.',       '1,200.',     '1200'],        // mid-typing
  ['1200.5',      '1,200.5',    '1200.5'],
  ['1200.567',    '1,200.56',   '1200.56'],     // cents are capped at two
  ['1,200,000',   '1,200,000',  '1200000'],     // already grouped
  ['.5',          '0.5',        '0.5'],
  ['88333.33',    '88,333.33',  '88333.33'],
  ['abc',         '',           ''],
  ['12ab34',      '1,234',      '1234'],
];

let pass = 0, fail = 0;
for (const [input, wantDisplay, wantValue] of cases) {
  const display = groupDigits(input);
  const value = ungroupDigits(display);
  const ok = display === wantDisplay && value === wantValue;
  console.log(`${ok ? '  ✔' : '  ✖'} ${JSON.stringify(input).padEnd(12)} -> display ${JSON.stringify(display).padEnd(14)} value ${JSON.stringify(value)}`
    + (ok ? '' : `   EXPECTED display ${JSON.stringify(wantDisplay)} value ${JSON.stringify(wantValue)}`));
  ok ? pass++ : fail++;
}

// Round-trip: a value the system supplies must survive display and come back equal.
console.log('\n  round-trip of values the system supplies:');
for (const n of [196666.67, 536666.65, 88333.33, 2360000, 0.02, 76666.67, 1, 99999999.99]) {
  const back = Number(ungroupDigits(groupDigits(String(n))));
  const ok = back === n;
  console.log(`${ok ? '  ✔' : '  ✖'} ${String(n).padEnd(14)} -> ${back}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
