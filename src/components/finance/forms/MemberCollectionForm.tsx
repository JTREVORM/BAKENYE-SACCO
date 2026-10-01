'use client';

import { useEffect, useMemo, useState } from 'react';
import { recordMemberCollection } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from '@/components/forms/FinancialForm';
import { MemberPicker, type PickedMember } from '@/components/forms/MemberPicker';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { createClient } from '@/lib/supabase/client';
import { formatUGX } from '@/lib/money';
import { toISODate } from '@/lib/format';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_META, COLLECTION_TYPES } from '@/lib/treasury-format';
import { RECEIVING_LABEL } from '@/lib/receiving-accounts';
import { AccountSelect, AccountSummary, defaultAccountId, type AccountOption } from '../AccountSelect';
import { BankMethodSelect, RecordedBy, beforeAfter, dateLine, methodForAccountType } from './fields';
import type { CategoryRow, PaymentMethod } from '@/types/db';
import type { CollectionType } from '@/types/treasury';

/**
 * The account the form opens on: a merchant account for the merchant screen,
 * otherwise whichever account a manager marked as the default, otherwise cash.
 * Never a hard-coded method.
 */
function openingAccount(accounts: AccountOption[], merchantOnly: boolean): string {
  if (merchantOnly) return defaultAccountId(accounts, 'merchant');
  const active = accounts.filter((a) => a.status === 'active');
  return (
    active.find((a) => a.is_default) ??
    active.find((a) => a.account_type === 'cash') ??
    active[0]
  )?.id ?? '';
}

type MemberLoan = { loan_id: string; loan_no: string; outstanding: number };

/**
 * Record money a member paid.
 *
 * The cashier names the account the money was received into - one of the
 * SACCO's own active accounts, each listed individually - and the payment
 * method follows from it rather than the other way round. That is the whole
 * point: "Mobile Money" cannot say which merchant wallet took the money when
 * the SACCO runs an Airtel code and an MTN code, and the ledger credits the
 * account that is named here.
 *
 * With `preset="merchant"` this is the Record Merchant Collection form: only
 * merchant accounts are offered, and the provider and merchant code of the
 * chosen one are shown alongside the reference field.
 *
 * Phase One is manual: the provider reference is recorded as typed. Nothing
 * here contacts MTN, Airtel or any bank, and nothing claims to have verified
 * the payment with them.
 */
export function MemberCollectionForm({
  accounts,
  incomeCategories,
  sharePrice,
  recorderName,
  preset,
  initialMember,
  initialType,
  doneHref,
}: {
  accounts: AccountOption[];
  incomeCategories: CategoryRow[];
  sharePrice: number | null;
  recorderName: string;
  preset?: 'merchant';
  initialMember?: PickedMember | null;
  initialType?: CollectionType;
  doneHref: string;
}) {
  const merchantOnly = preset === 'merchant';

  const [member, setMember] = useState<PickedMember | null>(initialMember ?? null);
  const [type, setType] = useState<CollectionType>(initialType ?? 'savings');
  const [amount, setAmount] = useState<number | null>(null);
  const [bankMethod, setBankMethod] = useState<PaymentMethod>('bank_transfer');
  const [accountId, setAccountId] = useState(() => openingAccount(accounts, merchantOnly));
  const [paidOn, setPaidOn] = useState(toISODate());
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [loans, setLoans] = useState<MemberLoan[]>([]);
  const [loanId, setLoanId] = useState('');
  const [incomeCategoryId, setIncomeCategoryId] = useState('');

  const account = accounts.find((a) => a.id === accountId);
  const accountType = account?.account_type ?? 'cash';
  const method = methodForAccountType(account?.account_type, bankMethod);
  const needsReference = accountType === 'merchant' || accountType === 'bank';
  const loan = loans.find((l) => l.loan_id === loanId);
  const feeCategories = useMemo(() => incomeCategories.filter((c) => !c.is_system), [incomeCategories]);

  // Any loan the member is repaying, read when they are chosen. There is
  // nothing else about them to look up: savings are open and monthly, so there
  // is no cadence and no category to fetch.
  useEffect(() => {
    if (!member) {
      setLoans([]);
      setLoanId('');
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: loanRows } = await supabase
        .from('loan_balances')
        .select('loan_id, loan_no, outstanding, status')
        .eq('member_id', member.id)
        .in('status', ['active', 'disbursed', 'defaulted']);
      if (cancelled) return;
      const list = ((loanRows ?? []) as MemberLoan[]).map((l) => ({
        ...l,
        outstanding: Number(l.outstanding),
      }));
      setLoans(list);
      setLoanId(list[0]?.loan_id ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [member]);

  const shares = sharePrice && amount ? amount / sharePrice : null;
  const sharesInvalid = type === 'shares' && !!amount && (!sharePrice || !Number.isInteger(shares));
  const overpaysLoan = type === 'loan_repayment' && !!loan && !!amount && amount > loan.outstanding;

  function summary(): FinancialSummaryLine[] {
    const typeLabel = COLLECTION_TYPES.find((c) => c.value === type)?.label ?? type;
    const balance = Number(account?.balance ?? 0);
    return [
      { label: 'Member', value: member ? `${member.full_name} (${member.member_no})` : '—' },
      {
        label: 'Transaction type',
        value:
          type === 'shares' && shares
              ? `${typeLabel} · ${shares} share${shares === 1 ? '' : 's'}`
              : type === 'loan_repayment' && loan
                ? `${typeLabel} · ${loan.loan_no}`
                : type === 'fee'
                  ? incomeCategories.find((c) => c.id === incomeCategoryId)?.name ?? typeLabel
                  : typeLabel,
      },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      {
        label: RECEIVING_LABEL,
        value: account ? `${account.name} (${ACCOUNT_TYPE_META[account.account_type].label})` : '—',
      },
      { label: 'Account balance', value: beforeAfter(balance, balance + (amount ?? 0)) },
      { label: 'Date', value: dateLine(paidOn) },
      ...(reference.trim() ? [{ label: 'Reference', value: reference.trim() }] : []),
      ...(description.trim() ? [{ label: 'Description', value: description.trim() }] : []),
      { label: 'Recorded by', value: recorderName },
    ];
  }

  return (
    <FinancialForm
      action={recordMemberCollection}
      idempotencyPrefix={merchantOnly ? 'merchant-collection' : 'collection'}
      submitLabel="Record collection"
      pendingLabel="Recording…"
      successTitle="Collection recorded"
      referenceLabel="Transaction reference"
      confirmTitle={member ? `Received from ${member.full_name}` : 'Please confirm'}
      confirmPrompt={
        needsReference
          ? 'This records a payment that has already been received. The reference is recorded as typed - the system does not verify it with the provider or bank. A recorded payment can only be corrected by a reversal.'
          : undefined
      }
      amount={() => amount}
      summary={summary}
      doneHref={doneHref}
      doneLabel="Back to finance"
      receiptHref={(r) => `/staff/transactions/${r.transaction_id}`}
      canConfirm={!!member && !!amount && !!accountId}
      validate={() => {
        if (!member) return 'Choose the member who paid.';
        if (!amount || amount <= 0) return 'Enter the amount received.';
        if (!accountId) return 'Choose the account the money was received into.';
        if (needsReference && !reference.trim()) {
          return accountType === 'merchant'
            ? 'Enter the mobile money transaction reference from the confirmation message.'
            : 'Enter the bank transfer, deposit slip or cheque reference.';
        }
        if (type === 'shares' && !sharePrice) return 'The share price has not been set.';
        if (sharesInvalid) return `${formatUGX(amount)} is not a whole number of shares at ${formatUGX(sharePrice)} each.`;
        if (type === 'loan_repayment' && !loanId) return 'This member has no loan being repaid.';
        if (overpaysLoan) return `The loan has ${formatUGX(loan!.outstanding)} outstanding. A repayment cannot exceed it.`;
        if (type === 'fee' && !incomeCategoryId) return 'Choose what the fee is for.';
        if (paidOn > toISODate()) return 'A payment cannot be dated in the future.';
        return null;
      }}
    >
      <input type="hidden" name="method" value={method} />

      <div className="flex flex-col gap-5">
        {merchantOnly ? (
          <Alert tone="info" title="Recorded manually - Phase One">
            Record a mobile money payment that has already reached the SACCO&apos;s merchant
            account. The system records the reference you type; it does not contact the provider
            or verify the transaction automatically.
          </Alert>
        ) : null}

        <MemberPicker name="member_id" initial={member} onSelect={setMember} />

        {member ? (
          <p className="-mt-2 text-label-md font-normal text-on-surface-variant">
            Member number <span className="tabular font-semibold text-on-surface">{member.member_no}</span>

          </p>
        ) : null}

        <Field label="Transaction type" htmlFor="collection-type" required
          hint={COLLECTION_TYPES.find((c) => c.value === type)?.hint}>
          <Select
            id="collection-type"
            name="collection_type"
            value={type}
            onChange={(e) => setType(e.target.value as CollectionType)}
          >
            {COLLECTION_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        {/* Savings are monthly and open: there is no cadence to choose and no
            target to meet, so the form asks for the amount and nothing else. */}
        {type === 'savings' ? <input type="hidden" name="savings_kind" value="monthly" /> : null}

        {type === 'loan_repayment' ? (
          loans.length === 0 ? (
            <Alert tone="warning">{member ? 'This member has no loan being repaid.' : 'Choose the member first.'}</Alert>
          ) : (
            <Field label="Loan" htmlFor="collection-loan" required
              hint={loan ? `${formatUGX(loan.outstanding)} outstanding.` : undefined}>
              <Select id="collection-loan" name="loan_id" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
                {loans.map((l) => (
                  <option key={l.loan_id} value={l.loan_id}>
                    {l.loan_no} · {formatUGX(l.outstanding)} outstanding
                  </option>
                ))}
              </Select>
            </Field>
          )
        ) : null}

        {type === 'fee' ? (
          <Field label="Fee for" htmlFor="collection-fee" required>
            <Select id="collection-fee" name="income_category_id" value={incomeCategoryId}
              onChange={(e) => setIncomeCategoryId(e.target.value)}>
              <option value="" disabled>
                Choose…
              </option>
              {feeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field
          label="Amount received"
          htmlFor="collection-amount"
          required
          error={
            sharesInvalid
              ? `Shares cost ${formatUGX(sharePrice)} each - enter a whole number of shares.`
              : overpaysLoan
                ? `More than the ${formatUGX(loan!.outstanding)} outstanding.`
                : null
          }
          hint={type === 'shares' && sharePrice ? `One share costs ${formatUGX(sharePrice)}.${shares && Number.isInteger(shares) ? ` That is ${shares} share${shares === 1 ? '' : 's'}.` : ''}` : undefined}
        >
          <MoneyInput id="collection-amount" name="amount" value={amount ?? ''} onValueChange={setAmount}
            required invalid={sharesInvalid || overpaysLoan} />
        </Field>

        <AccountSelect
          id="collection-account"
          name="account_id"
          label={RECEIVING_LABEL}
          accounts={accounts}
          types={merchantOnly ? ['merchant'] : ACCOUNT_TYPES}
          value={accountId}
          onChange={setAccountId}
          hint="The account that actually takes the money. Finance balances follow this choice."
        />
        <AccountSummary account={account} />

        {/* Bank money moves by transfer or by cheque; every other account has
            one way in, so this is the only method question that remains. */}
        {accountType === 'bank' ? (
          <BankMethodSelect
            id="collection-bank-method"
            value={bankMethod}
            onChange={setBankMethod}
          />
        ) : null}

        <Field
          label={accountType === 'merchant' ? 'Provider transaction reference' : accountType === 'bank' ? 'Bank or cheque reference' : 'Receipt book reference'}
          htmlFor="collection-ref"
          required={needsReference}
          hint="Must be unique - the same reference cannot be recorded twice."
        >
          <Input id="collection-ref" name="external_ref" value={reference}
            onChange={(e) => setReference(e.target.value)} maxLength={80} autoComplete="off"
            placeholder={accountType === 'merchant' ? 'From the confirmation SMS' : 'Optional'} className="tabular" />
        </Field>

        <Field label="Date received" htmlFor="collection-date" required>
          <Input id="collection-date" name="paid_on" type="date" value={paidOn} max={toISODate()}
            onChange={(e) => setPaidOn(e.target.value)} required />
        </Field>

        <Field label="Description" htmlFor="collection-description" hint="Optional - shown on the ledger.">
          <Input id="collection-description" name="description" value={description}
            onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>

        <Field label="Notes" htmlFor="collection-notes" hint="Optional - kept with the audit record.">
          <Textarea id="collection-notes" name="notes" rows={2} value={notes}
            onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>

        <RecordedBy name={recorderName} />
      </div>
    </FinancialForm>
  );
}
