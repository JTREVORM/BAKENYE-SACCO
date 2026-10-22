'use client';

import { useState } from 'react';
import { recordExpenseRequest } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from '@/components/forms/FinancialForm';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { CUSTOM_EXPENSE_MAX_LENGTH, expenseCategoryLabel, isOtherExpenseCategory } from '@/lib/expenses';
import { toISODate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { AccountSelect, AccountSummary, defaultAccountId, type AccountOption } from '../AccountSelect';
import { BankMethodSelect, DocumentField, RecordedBy, dateLine, methodForAccountType } from './fields';
import type { CategoryRow, PaymentMethod } from '@/types/db';

/**
 * File an operating expense.
 *
 * Money spent is an expense; money drawn from the bank to spend is not - that
 * is a withdrawal, recorded separately. This form files a request against the
 * account it will be paid from, and nothing leaves that account until a
 * manager approves it.
 */
export function ExpenseForm({
  accounts,
  categories,
  recorderName,
  doneHref,
}: {
  accounts: AccountOption[];
  categories: CategoryRow[];
  recorderName: string;
  doneHref: string;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [customExpense, setCustomExpense] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(toISODate());
  const [accountId, setAccountId] = useState(() => defaultAccountId(accounts, 'cash'));
  const [bankMethod, setBankMethod] = useState<PaymentMethod>('bank_transfer');
  const [payee, setPayee] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const account = accounts.find((a) => a.id === accountId);
  const category = categories.find((c) => c.id === categoryId);
  const isOther = isOtherExpenseCategory(category?.name);
  const method = methodForAccountType(account?.account_type, bankMethod);
  const balance = Number(account?.balance ?? 0);
  const exceeds = !!amount && !!account && amount > balance;

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Category', value: expenseCategoryLabel(category?.name ?? '—', isOther ? customExpense : null) },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      { label: 'To be paid from', value: account ? `${account.name} (holds ${formatUGX(balance)})` : '—' },
      { label: 'Method', value: PAYMENT_METHOD_LABELS[method] },
      ...(payee.trim() ? [{ label: 'Payee', value: payee.trim() }] : []),
      { label: 'Date', value: dateLine(date) },
      { label: 'Description', value: description || '—' },
      { label: 'Recorded by', value: recorderName },
    ];
  }

  return (
    <FinancialForm
      submissionKind="request"
      action={recordExpenseRequest}
      idempotencyPrefix="expense"
      submitLabel="Submit for approval"
      pendingLabel="Submitting…"
      successTitle="Submitted for approval"
      referenceLabel="Payment number"
      confirmPrompt="This files a request. No money leaves the account until a manager approves it."
      amount={() => amount}
      summary={summary}
      doneHref={doneHref}
      doneLabel="Back to expenses"
      canConfirm={!!categoryId && !!amount && !!accountId && (!isOther || !!customExpense.trim())}
      validate={() => {
        if (!categoryId) return 'Choose an expense category.';
        if (isOther && !customExpense.trim()) return 'Specify expense when choosing Other.';
        if (!amount || amount <= 0) return 'Enter the amount.';
        if (!accountId) return 'Choose the account this expense is paid from.';
        if (description.trim().length < 3) return 'Describe this expense.';
        return null;
      }}
    >
      <input type="hidden" name="method" value={method} />
      <div className="flex flex-col gap-5">
        <Field label="Expense category" htmlFor="expense-category" required>
          <Select id="expense-category" name="category_id" value={categoryId} onChange={(e) => {
            setCategoryId(e.target.value);
            setCustomExpense('');
          }}>
            <option value="" disabled>
              Choose a category…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        {isOther ? (
          <Field label="Specify expense" htmlFor="expense-custom" required>
            <Input id="expense-custom" name="custom_expense" value={customExpense}
              onChange={(e) => setCustomExpense(e.target.value)} required maxLength={CUSTOM_EXPENSE_MAX_LENGTH}
              placeholder="Enter the expense type or description" />
          </Field>
        ) : null}

        <Field label="Amount" htmlFor="expense-amount" required>
          <MoneyInput id="expense-amount" name="amount" value={amount ?? ''} onValueChange={setAmount} required />
        </Field>

        <Field label="Description" htmlFor="expense-description" required hint="What was bought, and why.">
          <Textarea id="expense-description" name="description" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="e.g. Stationery for the front desk" />
        </Field>

        <AccountSelect id="expense-account" name="payment_account_id" label="Paid from" accounts={accounts}
          types={['cash', 'bank', 'merchant']} value={accountId} onChange={setAccountId} />
        <AccountSummary account={account} />
        {exceeds ? (
          <Alert tone="warning">
            {account?.name} holds {formatUGX(balance)} today. The request can be filed, but it cannot be
            approved until the account holds enough.
          </Alert>
        ) : null}

        {account?.account_type === 'bank' ? <BankMethodSelect value={bankMethod} onChange={setBankMethod} /> : null}

        <Field label="Payee" htmlFor="expense-payee" hint="Optional - the supplier or person paid.">
          <Input id="expense-payee" name="payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={160} />
        </Field>

        <Field label="Date" htmlFor="expense-date" required>
          <Input id="expense-date" name="spent_on" type="date" value={date} max={toISODate()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Reference" htmlFor="expense-ref" hint="Optional - invoice or receipt number.">
          <Input id="expense-ref" name="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
        </Field>

        <DocumentField label="Receipt or invoice" hint="PDF, JPEG, PNG or WebP, up to 5 MB." />

        <Field label="Notes" htmlFor="expense-notes">
          <Textarea id="expense-notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>

        <RecordedBy name={recorderName} />
      </div>
    </FinancialForm>
  );
}
