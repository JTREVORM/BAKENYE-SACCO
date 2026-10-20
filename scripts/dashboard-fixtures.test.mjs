import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile('src/lib/fixtures.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const fixtures = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('member share figures and equity agree with the fixture share price', () => {
  for (const m of fixtures.FIXTURE_MEMBERS) {
    assert.equal(m.share_value, m.shares_owned * m.share_price);
    assert.equal(m.share_value, m.share_value_at_current_price);
    assert.equal(m.total_equity, m.savings_balance + m.share_value);
  }
  const view = fixtures.FIXTURE_COLLECTION_VIEW;
  assert.equal(view.member.share_value, 100000);
  assert.equal(view.member.share_value, view.share_progress.share_value);
});

test('collection months, dates and history describe the selected member', () => {
  const view = fixtures.FIXTURE_COLLECTION_VIEW;
  assert.equal(new Set(view.schedules.map(s => s.period_start)).size, view.schedules.length);
  for (const s of view.schedules) {
    assert.equal(s.member_id, view.member.id);
    assert.equal(s.cycle, fixtures.fixtureMonthLabel(s.period_start));
    assert.equal(s.period_label, s.cycle);
    assert.equal(s.period_end.slice(0, 7), s.period_start.slice(0, 7));
    if (s.last_paid_on) assert.ok(s.last_paid_on >= s.period_start && s.last_paid_on <= s.period_end);
  }
  for (const payment of view.history) {
    assert.equal(payment.cycle, fixtures.fixtureMonthLabel(payment.transaction_date));
    const month = view.schedules.find(s => s.period_id === payment.period_id);
    assert.ok(month);
    assert.equal(month.cycle, payment.cycle);
    assert.equal(month.member_id, payment.member_id);
  }
  assert.equal(view.current.period_start.slice(0, 7), view.as_of.slice(0, 7));
  for (const t of fixtures.FIXTURE_TRANSACTIONS) assert.equal(t.created_at.slice(0, 10), t.occurred_on);
  for (const bucket of fixtures.FIXTURE_TREND) assert.equal(bucket.label, fixtures.fixtureMonthLabel(bucket.bucket).split(' ')[0]);
});

test('cashier receipts use receipt date, excluding other dates and outgoing money', () => {
  const { FIXTURE_TRANSACTIONS: txs, fixtureReceiptsForDate: receiptsFor } = fixtures;
  assert.equal(receiptsFor('2026-10-20').length, 0);
  assert.deepEqual(receiptsFor('2026-08-30').map(r => r.receipt_no), ['SAV260830004']);
  const mixed = [
    { ...txs[0], occurred_on: '2026-08-30', created_at: '2026-08-31T08:00:00Z' },
    { ...txs[1], occurred_on: '2026-08-29', created_at: '2026-08-30T08:00:00Z' },
    { ...txs[2], occurred_on: '2026-08-30' },
    { ...txs[3], occurred_on: '2026-08-30' },
  ];
  const rows = receiptsFor('2026-08-30', mixed);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.receipt_date === '2026-08-30'));
  assert.equal(rows.filter(r => r.status === 'posted').reduce((sum, r) => sum + r.amount, 0), 50000);
});

test('rolling collection labels match dates at month/year/leap-day boundaries', () => {
  for (const date of ['2026-10-20', '2027-01-01', '2028-02-29']) {
    const { view, members } = fixtures.fixtureCollectionForDate(date);
    assert.equal(view.as_of, date);
    assert.equal(view.current.period_start.slice(0, 7), date.slice(0, 7));
    assert.equal(view.member.share_value, 100000);
    for (const month of view.schedules) {
      assert.equal(month.cycle, fixtures.fixtureMonthLabel(month.period_start));
      assert.equal(month.period_label, month.cycle);
      if (month.last_paid_on) assert.ok(month.last_paid_on <= date && month.last_paid_on >= month.period_start && month.last_paid_on <= month.period_end);
    }
    for (const payment of view.history) {
      assert.ok(payment.transaction_date <= date);
      assert.equal(payment.cycle, fixtures.fixtureMonthLabel(payment.transaction_date));
      assert.equal(payment.cycle, view.schedules.find(s => s.period_id === payment.period_id).cycle);
    }
    assert.ok(members.every(m => !m.last_saved_on || m.last_saved_on <= date));
  }
});

test('Finance QA movements reconcile by account and use the source payment method', () => {
  const rows = fixtures.fixtureFinanceLedger();
  const balances = { ...fixtures.FIXTURE_FINANCE_OPENING };
  for (const r of [...rows].reverse()) {
    const t = fixtures.FIXTURE_TRANSACTIONS.find(t => t.id === r.transaction_id);
    assert.equal(t.status, 'posted', 'Unpaired reversed samples are not modelled as posted ledger entries');
    assert.equal(r.account_type, t.method === 'cash' ? 'cash' : 'merchant');
    assert.equal(r.movement_class, t.direction === 'credit' ? 'payment' : 'collection');
    assert.equal(r.money_in, t.direction === 'debit' ? t.amount : 0);
    assert.equal(r.money_out, t.direction === 'credit' ? t.amount : 0);
    balances[r.account_type] += r.money_in - r.money_out;
    assert.equal(r.running_balance, balances[r.account_type]);
    assert.equal(r.balance_after, r.running_balance);
  }
  for (const type of ['cash', 'merchant', 'bank']) assert.equal(balances[type], fixtures.FIXTURE_FINANCE_TOTALS[type]);
  assert.equal(Object.values(balances).reduce((a,b) => a+b,0), fixtures.FIXTURE_FINANCE_TOTALS.total);
  assert.equal(rows.find(r => r.txn_type === 'loan_disbursement').running_balance, 2050000);
  assert.equal(rows.find(r => r.txn_type === 'loan_repayment').running_balance, 485000);
  assert.deepEqual(rows.map(r => r.entry_date), ['2026-08-30','2026-08-29','2026-08-20']);
});
