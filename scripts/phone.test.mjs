import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Exercise the actual TypeScript module with Node's test runner on Node 18+.
const source = new URL('../src/lib/phone.ts', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
// Keep library option objects in the same JavaScript realm as their validator.
vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n })`)(createRequire(source), module, module.exports);
const { normalisePhone, normaliseUgandanMobile, formatPhone } = module.exports;

for (const raw of ['0772123456', '0772 123 456', '(0772) 123-456', '772123456', '256772123456', '+256 772 123 456', '00256772123456']) {
  test(`Uganda keeps its existing format: ${raw}`, () => {
    assert.equal(normalisePhone(raw), '+256772123456');
    assert.equal(normaliseUgandanMobile(raw), '+256772123456');
  });
}
for (const [country, raw, expected] of [
  ['Canada', ' +1 (416) 555-0123 ', '+14165550123'],
  ['UK', '+44 20 7946 0958', '+442079460958'],
  ['Kenya', '+254 712 123456', '+254712123456'],
  ['Russia', '+7 912 345 6789', '+79123456789'],
  ['Uganda landline', '+256 414 123456', '+256414123456'],
  ['Saint Helena (short international number)', '+290 51234', '+29051234'],
]) {
  test(`${country} retains its international code and is idempotent`, () => {
    assert.equal(normalisePhone(raw), expected);
    assert.equal(normalisePhone(expected), expected);
    if (!expected.startsWith('+256')) assert.equal(normaliseUgandanMobile(raw), null);
  });
}
for (const raw of [null, undefined, '', ' \t ', '123', '4165550123', '00442079460958', '+999123456789', '+1416', '+10125550123', '+1416555012345678', '+4402079460958', '+254012345678', '+2560712123456', '+772123456', '++14165550123', '+1+4165550123', 'call 0772123456', '+14165550123 ext 9']) {
  test(`invalid phone is rejected: ${JSON.stringify(raw)}`, () => assert.equal(normalisePhone(raw), null));
}
test('Unicode whitespace is trimmed consistently', () => assert.equal(normalisePhone('\u00a0+1\u2003416 555 0123\ufeff'), '+14165550123'));
test('Uganda display remains local', () => assert.equal(formatPhone('+256772123456'), '0772 123 456'));
test('international display never loses the plus or resembles a Uganda local number', () => {
  for (const phone of ['+14165550123', '+442079460958', '+254712123456', '+3545512345']) assert.equal(formatPhone(phone), phone);
});
test('missing phone display remains unchanged', () => assert.equal(formatPhone(null), '—'));
