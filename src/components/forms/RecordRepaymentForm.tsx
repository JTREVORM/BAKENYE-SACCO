'use client';

import { useState } from 'react';
import { recordMemberCollection } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { ReceivingAccountFields, useReceivingAccount } from './ReceivingAccountField';
import { Field, Input, MoneyInput } from '@/components/ui/form';
import { Money, ProgressBar } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { formatUGX, toNumber } from '@/lib/money';
import { formatDate, toISODate } from '@/lib/format';
import { RECEIVING_LABEL } from '@/lib/receiving-accounts';
import type { CollectionAccount } from '@/types/access';
import type { LoanBalanceRow } from '@/types/db';

/**
 * Record a loan repayment.
 *
 * The outstanding balance is passed in from `loan_balances` — a derived view,
 * not a stored column — and the server re-derives it inside the transaction
 * before accepting the payment. An overpayment is rejected there, so two
 * cashiers taking the last installment at the same moment cannot both succeed.
 *
 * The repayment is credited to the account the cashier chose, so a repayment
 * that arrived on the Airtel merchant code is held there and not in the cash
 * drawer.
 */
export function RecordRepaymentForm({
  loan,
  memberName,
  accounts,
  doneHref,
  staff = true,
}: {
  loan: LoanBalanceRow;
  memberName: string;
  /** The SACCO's active receiving accounts, from `collection_accounts()`. */
  accounts: CollectionAccount[];
  doneHref?: string;
  staff?: boolean;
}) {
  const outstanding = toNumber(loan.outstanding);
  const installment = toNumber(loan.installment_amount);
  const overdue = toNumber(loan.overdue_amount);

  const [amount, setAmount] = useState<number | null>(
    overdue > 0 ? Math.min(overdue, outstanding) : Math.min(installment, outstanding),
  );
  const [paidOn, setPaidOn] = useState(toISODate());
  const into = useReceivingAccount(accounts);

  const remainingAfter = Math.max(outstanding - (amount ?? 0), 0);
  const clears = amount != null && amount >= outstanding - 0.005;

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Member', value: memberName },
      { label: 'Loan', value: loan.loan_no },
      { label: 'Payment', value: formatUGX(amount), emphasis: true },
      { label: 'Balance before', value: formatUGX(outstanding) },
      {
        label: 'Balance after',
        value: clears ? 'Fully repaid' : formatUGX(remainingAfter),
        emphasis: true,
      },
      { label: RECEIVING_LABEL, value: into.label },
      ...(into.reference.trim()
        ? [{ label: 'Reference', value: into.reference.trim() }]
        : []),
      { label: 'Payment date', value: formatDate(paidOn) },
    ];
  }

  const quickPicks = [
    ...(overdue > 0 ? [{ label: 'Overdue', value: Math.min(overdue, outstanding) }] : []),
    ...(installment > 0 && installment < outstanding
      ? [{ label: 'One installment', value: installment }]
      : []),
    { label: 'Full balance', value: outstanding },
  ];

  return (
    <FinancialForm
      action={recordMemberCollection}
      idempotencyPrefix="repay"
      submitLabel="Record repayment"
      pendingLabel="Recording…"
      successTitle="Repayment recorded"
      amount={() => amount}
      summary={summary}
      canConfirm={!!amount && amount > 0 && !!into.accountId}
      doneHref={doneHref}
      doneLabel="Back to loan"
      receiptHref={(r) =>
        r.transaction_id
          ? `${staff ? '/staff' : ''}/transactions/${r.transaction_id}`
          : null
      }
      validate={() => {
        if (!amount || amount <= 0) return 'Enter the amount received.';
        if (amount > outstanding + 0.005)
          return `The outstanding balance is ${formatUGX(
            outstanding,
          )}. Enter that amount or less.`;
        return into.validate();
      }}
    >
      <input type="hidden" name="collection_type" value="loan_repayment" />
      <input type="hidden" name="loan_id" value={loan.loan_id} />
      <input type="hidden" name="member_id" value={loan.member_id} />

      <div className="flex flex-col gap-5">
        {/* Loan position, restated so the operator is never guessing. */}
        <div className="bg-surface-container-low rounded-xl p-4 shadow-neu-sm">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <p className="text-label-md font-label-md text-on-surface-variant">
                Outstanding balance
              </p>
              <Money
                value={outstanding}
                className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface"
              />
            </div>
            <p className="text-label-md font-label-md text-on-surface-variant tabular normal-case">
              {loan.loan_no}
            </p>
          </div>
          <ProgressBar
            value={toNumber(loan.percent_repaid)}
            tone="tertiary"
            label="Loan repayment progress"
          />
          <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
            {formatUGX(loan.amount_paid)} of {formatUGX(loan.total_payable)} repaid ·{' '}
            {Math.round(toNumber(loan.percent_repaid))}%
          </p>
        </div>

        {overdue > 0 ? (
          <Alert tone="warning" title="This loan is overdue">
            {formatUGX(overdue)} is past due
            {loan.days_overdue ? ` by ${loan.days_overdue} days` : ''}.
          </Alert>
        ) : null}

        <Field label="Amount received" htmlFor="amount" required>
          <MoneyInput
            id="amount"
            name="amount"
            value={amount ?? ''}
            onValueChange={setAmount}
            required
            invalid={!!amount && amount > outstanding + 0.005}
          />
        </Field>

        <div className="-mt-2 flex flex-wrap gap-2">
          {quickPicks.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setAmount(Math.round(p.value * 100) / 100)}
              className={`text-label-md font-label-md h-touch-target-min rounded-full px-4 normal-case transition-colors ${
                amount === Math.round(p.value * 100) / 100
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {p.label} · {formatUGX(p.value)}
            </button>
          ))}
        </div>

        {clears ? (
          <Alert tone="success" title="This payment clears the loan">
            The loan will be marked completed and its guarantors released.
          </Alert>
        ) : null}

        <ReceivingAccountFields state={into} idPrefix="repay" />

        <Field label="Payment date" htmlFor="paid_on" required>
          <Input
            id="paid_on"
            name="paid_on"
            type="date"
            value={paidOn}
            max={toISODate()}
            onChange={(e) => setPaidOn(e.target.value)}
            required
          />
        </Field>
      </div>
    </FinancialForm>
  );
}
