'use client';

import { useState } from 'react';
import { recordSavings } from '@/app/actions/financial';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { MemberPicker, type PickedMember } from './MemberPicker';
import { Field, MoneyInput, Select, Input, RadioCard } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import { formatDate, PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import type { PaymentMethod } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque'];

/**
 * Record a weekly or monthly savings contribution.
 *
 * The period is derived from the payment date on the server
 * (`savings_period_bounds`), so a cashier catching up on Monday for last week's
 * collection books it against the right week rather than the current one.
 */
export function RecordSavingsForm({
  member,
  lockMember = false,
  defaultKind = 'weekly',
  weeklyTarget,
  monthlyTarget,
  doneHref,
}: {
  member?: PickedMember | null;
  lockMember?: boolean;
  defaultKind?: 'weekly' | 'monthly';
  weeklyTarget?: number | null;
  monthlyTarget?: number | null;
  doneHref?: string;
}) {
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const [kind, setKind] = useState<'weekly' | 'monthly'>(defaultKind);
  const [amount, setAmount] = useState<number | null>(
    defaultKind === 'weekly' ? weeklyTarget ?? null : monthlyTarget ?? null,
  );
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(toISODate());

  const target = kind === 'weekly' ? weeklyTarget : monthlyTarget;

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Member', value: picked ? `${picked.full_name} (${picked.member_no})` : '—' },
      { label: 'Savings type', value: kind === 'weekly' ? 'Weekly savings' : 'Monthly savings' },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      ...(target
        ? [{ label: 'Period target', value: formatUGX(target) }]
        : []),
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

        <fieldset>
          <legend className="text-label-md font-label-md text-on-surface-variant mb-2 uppercase">
            Savings type
          </legend>
          <div className="flex flex-col gap-2">
            <RadioCard
              name="kind"
              value="weekly"
              checked={kind === 'weekly'}
              onChange={() => {
                setKind('weekly');
                if (weeklyTarget) setAmount(weeklyTarget);
              }}
              title="Weekly savings"
              description={
                weeklyTarget ? `Target ${formatUGX(weeklyTarget)} per week` : 'No weekly target set'
              }
              icon="savings"
            />
            <RadioCard
              name="kind"
              value="monthly"
              checked={kind === 'monthly'}
              onChange={() => {
                setKind('monthly');
                if (monthlyTarget) setAmount(monthlyTarget);
              }}
              title="Monthly savings"
              description={
                monthlyTarget
                  ? `Target ${formatUGX(monthlyTarget)} per month`
                  : 'No monthly target set'
              }
              icon="calendar_month"
            />
          </div>
        </fieldset>

        <Field
          label="Amount received"
          htmlFor="amount"
          required
          hint={target ? `Period target is ${formatUGX(target)}.` : undefined}
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
          hint="The savings period is worked out from this date."
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
