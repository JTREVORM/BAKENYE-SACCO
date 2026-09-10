'use client';

import { useState } from 'react';
import { createPayment } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from '@/components/forms/FinancialForm';
import { MemberPicker, type PickedMember } from '@/components/forms/MemberPicker';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { toISODate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { AccountSelect, AccountSummary, defaultAccountId, type AccountOption } from '../AccountSelect';
import { BankMethodSelect, DocumentField, RecordedBy, beforeAfter, dateLine, methodForAccountType } from './fields';
import type { PaymentMethod } from '@/types/db';
import type { PaymentCategoryRow } from '@/types/treasury';

/**
 * Record a payment that is not an operating expense: a refund to a member, a
 * dividend, an asset. Operating expenses have their own form, because they are
 * booked against the income and expenditure account and these are not.
 */
export function PaymentForm({
  accounts,
  categories,
  recorderName,
  approvalNote,
  doneHref,
}: {
  accounts: AccountOption[];
  categories: PaymentCategoryRow[];
  recorderName: string;
  approvalNote: string;
  doneHref: string;
}) {
  const [member, setMember] = useState<PickedMember | null>(null);
  const [payee, setPayee] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [accountId, setAccountId] = useState(() => defaultAccountId(accounts, 'cash'));
  const [bankMethod, setBankMethod] = useState<PaymentMethod>('bank_transfer');
  const [date, setDate] = useState(toISODate());
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  const account = accounts.find((a) => a.id === accountId);
  const method = methodForAccountType(account?.account_type, bankMethod);
  const balance = Number(account?.balance ?? 0);
  const exceeds = !!amount && !!account && amount > balance;
  const needsReference = account?.account_type === 'merchant' || account?.account_type === 'bank';

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Payee', value: payee || '—' },
      ...(member ? [{ label: 'Member', value: `${member.full_name} (${member.member_no})` }] : []),
      { label: 'Category', value: categories.find((c) => c.id === categoryId)?.name ?? '—' },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      { label: `Paid from: ${account?.name ?? '—'}`, value: beforeAfter(balance, balance - (amount ?? 0)) },
      { label: 'Method', value: PAYMENT_METHOD_LABELS[method] },
      { label: 'Date', value: dateLine(date) },
      ...(reference.trim() ? [{ label: 'Reference', value: reference.trim() }] : []),
      { label: 'Description', value: description || '—' },
      { label: 'Recorded by', value: recorderName },
      { label: 'Approval', value: approvalNote },
    ];
  }

  return (
    <FinancialForm
      action={createPayment}
      idempotencyPrefix="payment"
      submitLabel="Record payment"
      draftLabel="Save as draft - do not submit yet"
      pendingLabel="Recording…"
      successTitle={(r) =>
        r.status === 'completed' ? 'Payment made' : r.status === 'draft' ? 'Draft saved' : 'Submitted for approval'
      }
      referenceLabel="Payment number"
      amount={() => amount}
      summary={summary}
      doneHref={doneHref}
      doneLabel="Back to payments"
      receiptHref={(r) => (r.transaction_id ? `/staff/transactions/${r.transaction_id}` : null)}
      canConfirm={!!payee.trim() && !!categoryId && !!amount && !!accountId && !exceeds}
      validate={() => {
        if (!payee.trim()) return 'Enter who is being paid.';
        if (!categoryId) return 'Choose a payment category.';
        if (!amount || amount <= 0) return 'Enter the amount.';
        if (!accountId) return 'Choose the account the payment is made from.';
        if (exceeds) return `${account?.name} holds ${formatUGX(balance)}. It cannot pay ${formatUGX(amount)}.`;
        if (needsReference && !reference.trim()) return 'Enter the transaction, cheque or transfer reference.';
        if (description.trim().length < 3) return 'Describe what the payment is for.';
        return null;
      }}
    >
      <input type="hidden" name="method" value={method} />
      <div className="flex flex-col gap-5">
        <MemberPicker
          name="member_id"
          label="Member (optional)"
          required={false}
          initial={member}
          onSelect={(m) => {
            setMember(m);
            if (m && !payee.trim()) setPayee(m.full_name);
          }}
        />

        <Field label="Payee" htmlFor="payment-payee" required>
          <Input id="payment-payee" name="payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={160} />
        </Field>

        <Field label="Payment category" htmlFor="payment-category" required
          hint="Operating costs - rent, salaries, stationery - are recorded as expenses instead.">
          <Select id="payment-category" name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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

        <Field label="Amount" htmlFor="payment-amount" required
          error={exceeds ? `More than the ${formatUGX(balance)} in ${account?.name}.` : null}>
          <MoneyInput id="payment-amount" name="amount" value={amount ?? ''} onValueChange={setAmount} required invalid={exceeds} />
        </Field>

        <AccountSelect id="payment-account" name="account_id" label="Paid from" accounts={accounts}
          types={['cash', 'bank', 'merchant']} value={accountId} onChange={setAccountId} />
        <AccountSummary account={account} />

        {account?.account_type === 'bank' ? <BankMethodSelect value={bankMethod} onChange={setBankMethod} /> : null}

        <Field label="Date" htmlFor="payment-date" required>
          <Input id="payment-date" name="payment_date" type="date" value={date} max={toISODate()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label={needsReference ? 'Transaction, cheque or transfer reference' : 'Voucher reference'} htmlFor="payment-ref"
          required={needsReference}>
          <Input id="payment-ref" name="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="tabular" />
        </Field>

        <Field label="Description" htmlFor="payment-description" required>
          <Textarea id="payment-description" name="description" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="e.g. Refund of a duplicate share payment" />
        </Field>

        <DocumentField label="Supporting document" hint="Invoice, voucher or signed receipt. PDF, JPEG, PNG or WebP, up to 5 MB." />

        <Field label="Notes" htmlFor="payment-notes">
          <Textarea id="payment-notes" name="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>

        <RecordedBy name={recorderName} />
        <Alert tone="info">{approvalNote}</Alert>
      </div>
    </FinancialForm>
  );
}
