'use client';

import { useMemo, useState } from 'react';
import { recordOtherReceipt } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from '@/components/forms/FinancialForm';
import { MemberPicker, type PickedMember } from '@/components/forms/MemberPicker';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import { toISODate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { AccountSelect, AccountSummary, defaultAccountId, type AccountOption } from '../AccountSelect';
import { BankMethodSelect, RecordedBy, beforeAfter, dateLine, methodForAccountType } from './fields';
import type { CategoryRow, PaymentMethod } from '@/types/db';

/**
 * Money received that is not a member contribution - bank interest, a grant,
 * rent, a non-member's fee. It is SACCO income, booked to an income category
 * and into the account it arrived in.
 */
export function OtherReceiptForm({
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
  // The two system categories are booked by the loan functions themselves.
  const options = useMemo(() => categories.filter((c) => !c.is_system), [categories]);

  const [member, setMember] = useState<PickedMember | null>(null);
  const [payer, setPayer] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [accountId, setAccountId] = useState(() => defaultAccountId(accounts, 'bank') || defaultAccountId(accounts, 'cash'));
  const [bankMethod, setBankMethod] = useState<PaymentMethod>('bank_transfer');
  const [date, setDate] = useState(toISODate());
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');

  const account = accounts.find((a) => a.id === accountId);
  const method = methodForAccountType(account?.account_type, bankMethod);
  const balance = Number(account?.balance ?? 0);

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Received from', value: member ? `${member.full_name} (${member.member_no})` : payer || '—' },
      { label: 'Category', value: options.find((c) => c.id === categoryId)?.name ?? '—' },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      { label: `Into: ${account?.name ?? '—'}`, value: beforeAfter(balance, balance + (amount ?? 0)) },
      { label: 'Method', value: PAYMENT_METHOD_LABELS[method] },
      { label: 'Date', value: dateLine(date) },
      ...(reference.trim() ? [{ label: 'Reference', value: reference.trim() }] : []),
      { label: 'Recorded by', value: recorderName },
    ];
  }

  return (
    <FinancialForm
      action={recordOtherReceipt}
      idempotencyPrefix="receipt"
      submitLabel="Record receipt"
      pendingLabel="Recording…"
      successTitle="Receipt recorded"
      amount={() => amount}
      summary={summary}
      doneHref={doneHref}
      doneLabel="Back to receipts"
      receiptHref={(r) => `/staff/transactions/${r.transaction_id}`}
      canConfirm={!!categoryId && !!amount && !!accountId && (!!member || !!payer.trim())}
      validate={() => {
        if (!member && !payer.trim()) return 'Enter who paid.';
        if (!categoryId) return 'Choose an income category.';
        if (!amount || amount <= 0) return 'Enter the amount.';
        if (!accountId) return 'Choose the account the money was received into.';
        return null;
      }}
    >
      <input type="hidden" name="method" value={method} />
      <div className="flex flex-col gap-5">
        <MemberPicker name="member_id" label="Member (optional)" required={false} initial={member}
          onSelect={(m) => { setMember(m); if (m) setPayer(m.full_name); }} />

        <Field label="Payer" htmlFor="receipt-payer" required={!member}>
          <Input id="receipt-payer" name="payer_name" value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={160}
            placeholder="e.g. Stanbic Bank (interest)" />
        </Field>

        <Field label="Income category" htmlFor="receipt-category" required>
          <Select id="receipt-category" name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled>
              Choose a category…
            </option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Amount" htmlFor="receipt-amount" required>
          <MoneyInput id="receipt-amount" name="amount" value={amount ?? ''} onValueChange={setAmount} required />
        </Field>

        <AccountSelect id="receipt-account" name="account_id" label="Received into" accounts={accounts}
          types={['bank', 'cash', 'merchant']} value={accountId} onChange={setAccountId} />
        <AccountSummary account={account} />
        {account?.account_type === 'bank' ? <BankMethodSelect value={bankMethod} onChange={setBankMethod} /> : null}

        <Field label="Date received" htmlFor="receipt-date" required>
          <Input id="receipt-date" name="received_on" type="date" value={date} max={toISODate()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Reference" htmlFor="receipt-ref" hint="Provider, bank or receipt-book reference. Must be unique.">
          <Input id="receipt-ref" name="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="tabular" />
        </Field>

        <Field label="Description" htmlFor="receipt-description">
          <Textarea id="receipt-description" name="description" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>

        <RecordedBy name={recorderName} />
      </div>
    </FinancialForm>
  );
}
