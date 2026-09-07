'use client';

import { useState } from 'react';
import { recordCashMovement } from '@/app/actions/financial';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { MemberPicker, type PickedMember } from './MemberPicker';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Money } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { formatDate, PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import type { PaymentMethod } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque'];

/**
 * Deposit or withdrawal.
 *
 * The withdrawal path shows the available savings balance and blocks locally
 * once the amount exceeds it — but the real guard is in `record_cash_movement`,
 * which re-derives the balance from the ledger inside the transaction. Two
 * tellers serving the same member at the same moment cannot both succeed in
 * emptying the account.
 *
 * Share capital is deliberately excluded from what is withdrawable; it is not
 * liquid, and offering it here would promise money the SACCO will not release.
 */
export function CashMovementForm({
  type,
  member,
  lockMember = false,
  availableBalance,
  doneHref,
}: {
  type: 'deposit' | 'withdrawal';
  member?: PickedMember | null;
  lockMember?: boolean;
  availableBalance?: number;
  doneHref?: string;
}) {
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [occurredOn, setOccurredOn] = useState(toISODate());
  const [description, setDescription] = useState('');

  const isWithdrawal = type === 'withdrawal';
  const available = availableBalance ?? picked?.savings_balance ?? 0;
  const exceeds = isWithdrawal && !!amount && amount > Number(available);

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Member', value: picked ? `${picked.full_name} (${picked.member_no})` : '—' },
      { label: 'Type', value: isWithdrawal ? 'Withdrawal' : 'Deposit' },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      ...(isWithdrawal
        ? [
            { label: 'Balance before', value: formatUGX(available) },
            {
              label: 'Balance after',
              value: formatUGX(Number(available) - (amount ?? 0)),
              emphasis: true,
            },
          ]
        : []),
      { label: 'Payment method', value: PAYMENT_METHOD_LABELS[method] },
      { label: 'Date', value: formatDate(occurredOn) },
      ...(description ? [{ label: 'Note', value: description }] : []),
    ];
  }

  return (
    <FinancialForm
      action={recordCashMovement}
      idempotencyPrefix={type}
      submitLabel={isWithdrawal ? 'Record withdrawal' : 'Record deposit'}
      pendingLabel="Recording…"
      successTitle={isWithdrawal ? 'Withdrawal recorded' : 'Deposit recorded'}
      confirmPrompt={
        isWithdrawal
          ? 'Confirm the member has been paid this amount. A withdrawal can only be corrected by a reversal.'
          : undefined
      }
      amount={() => amount}
      summary={summary}
      canConfirm={!!picked && !!amount && !exceeds}
      doneHref={doneHref}
      doneLabel="Back"
      receiptHref={(r) => (r.transaction_id ? `/staff/transactions/${r.transaction_id}` : null)}
      validate={() => {
        if (!picked) return 'Choose the member.';
        if (!amount || amount <= 0) return 'Enter an amount.';
        if (exceeds)
          return `The member's available savings balance is ${formatUGX(
            available,
          )}. Share capital cannot be withdrawn.`;
        return null;
      }}
    >
      <input type="hidden" name="type" value={type} />

      <div className="flex flex-col gap-5">
        {lockMember && picked ? (
          <input type="hidden" name="member_id" value={picked.id} />
        ) : (
          <MemberPicker name="member_id" initial={picked} onSelect={setPicked} />
        )}

        {isWithdrawal && picked ? (
          <div className="bg-surface-container-low rounded-xl p-4 shadow-neu-sm">
            <p className="text-label-md font-label-md text-on-surface-variant">
              Available savings balance
            </p>
            <Money
              value={available}
              className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface"
            />
            <p className="text-label-md font-label-md text-on-surface-variant mt-1 normal-case">
              Share capital of {formatUGX(picked.share_value)} is not withdrawable.
            </p>
          </div>
        ) : null}

        <Field
          label="Amount"
          htmlFor="amount"
          required
          error={exceeds ? `This exceeds the available balance of ${formatUGX(available)}.` : null}
        >
          <MoneyInput
            id="amount"
            name="amount"
            value={amount ?? ''}
            onValueChange={setAmount}
            required
            invalid={exceeds}
          />
        </Field>

        {isWithdrawal && picked && Number(available) > 0 ? (
          <button
            type="button"
            onClick={() => setAmount(Number(available))}
            className="text-label-md font-label-md bg-surface-container text-on-surface-variant hover:bg-surface-container-high -mt-2 h-touch-target-min self-start rounded-full px-4 normal-case"
          >
            Withdraw everything · {formatUGX(available)}
          </button>
        ) : null}

        <Field label="Payment method" htmlFor="method" required>
          <Select
            id="method"
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Date" htmlFor="occurred_on" required>
          <Input
            id="occurred_on"
            name="occurred_on"
            type="date"
            value={occurredOn}
            max={toISODate()}
            onChange={(e) => setOccurredOn(e.target.value)}
            required
          />
        </Field>

        <Field label="Note" htmlFor="description" hint="Optional — appears on the receipt.">
          <Textarea
            id="description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder={isWithdrawal ? 'e.g. School fees withdrawal' : 'e.g. Ad-hoc savings top-up'}
          />
        </Field>

        {isWithdrawal ? (
          <Alert tone="warning">
            Confirm the member's identity before paying out. Withdrawals are recorded against their
            savings only.
          </Alert>
        ) : null}
      </div>
    </FinancialForm>
  );
}
