'use client';

import { useState } from 'react';
import { recordSavings } from '@/app/actions/financial';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { MemberPicker, type PickedMember } from './MemberPicker';
import { Field, MoneyInput, Select, Input } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import { formatDate, PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import type { PaymentMethod } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque'];

/**
 * Record a monthly savings contribution.
 *
 * Savings are open: the member says what they want to save and this records it.
 * There is no target, so the amount field starts empty and nothing here
 * suggests a figure — a prefilled amount would be the system telling a member
 * what to save.
 *
 * The month is derived from the payment date on the server
 * (`savings_period_bounds`), so a cashier catching up on the 2nd for last
 * month's collection books it against the right month rather than this one.
 */
export function RecordSavingsForm({
  member,
  lockMember = false,
  doneHref,
}: {
  member?: PickedMember | null;
  lockMember?: boolean;
  doneHref?: string;
}) {
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(toISODate());

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Member', value: picked ? `${picked.full_name} (${picked.member_no})` : '—' },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      { label: 'Payment method', value: PAYMENT_METHOD_LABELS[method] },
      { label: 'Payment date', value: formatDate(paidOn) },
    ];
  }

  return (
    <FinancialForm
      action={recordSavings}
      idempotencyPrefix="savings"
      submitLabel="Record savings"
      pendingLabel="Recording…"
      successTitle="Savings recorded"
      amount={() => amount}
      summary={summary}
      canConfirm={!!picked && !!amount}
      doneHref={doneHref}
      doneLabel="Back"
      receiptHref={(r) =>
        (r as { transaction_id?: string }).transaction_id
          ? `/staff/transactions/${(r as { transaction_id: string }).transaction_id}`
          : null
      }
      validate={() => {
        if (!picked) return 'Choose the member this payment is for.';
        if (!amount || amount <= 0) return 'Enter the amount received.';
        return null;
      }}
    >
      <div className="flex flex-col gap-5">
        {lockMember && picked ? (
          <input type="hidden" name="member_id" value={picked.id} />
        ) : (
          <MemberPicker name="member_id" initial={picked} onSelect={setPicked} />
        )}

        {/* Savings are monthly. The cadence is no longer a choice at the
            counter: `weekly` survives only on records raised before the rules
            changed. */}
        <input type="hidden" name="kind" value="monthly" />

        <Field
          label="Amount received"
          htmlFor="amount"
          required
          hint="Any amount the member chooses. There is no monthly target."
        >
          <MoneyInput
            id="amount"
            name="amount"
            value={amount ?? ''}
            onValueChange={setAmount}
            required
            enterKeyHint="next"
          />
        </Field>

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

        <Field
          label="Payment date"
          htmlFor="paid_on"
          required
          hint="The month these savings are filed under is worked out from this date."
        >
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
