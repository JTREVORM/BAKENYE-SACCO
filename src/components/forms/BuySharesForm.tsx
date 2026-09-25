'use client';

import { useState } from 'react';
import { buyShares } from '@/app/actions/financial';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { MemberPicker, type PickedMember } from './MemberPicker';
import { Field, Input, Select, Textarea, Button } from '@/components/ui/form';
import { Money } from '@/components/ui/primitives';
import { formatUGX } from '@/lib/money';
import { formatDate, PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import type { PaymentMethod } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque'];
const DEFAULT_QUICK_PICKS = [1, 5, 10, 20, 50, 100];

/**
 * Record a share purchase.
 *
 * Shares are bought in whole units at the SACCO's one price, and the total is
 * derived — the operator enters a *quantity*, never a shilling amount. That is
 * what keeps share capital from drifting into a savings-like balance nobody can
 * reconcile back to a share count.
 *
 * The total shown here is for the person at the counter to read. It is not what
 * is charged: the figure travels to the database as `expected_total`, which
 * multiplies quantity by its own price and refuses the sale if the two
 * disagree. There is no tier and no ceiling — any whole number of shares from
 * one upwards is a valid purchase.
 */
export function BuySharesForm({
  member,
  lockMember = false,
  unitPrice,
  currentShares,
  quickPicks,
  doneHref,
}: {
  member?: PickedMember | null;
  lockMember?: boolean;
  /** The SACCO's one share price — the same value `buy_shares()` charges. */
  unitPrice: number;
  currentShares?: number;
  /** One-tap quantities. Convenience only; any whole number is allowed. */
  quickPicks?: number[];
  doneHref?: string;
}) {
  const picks = quickPicks && quickPicks.length > 0 ? quickPicks : DEFAULT_QUICK_PICKS;
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const [quantity, setQuantity] = useState<number>(1);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [purchasedOn, setPurchasedOn] = useState(toISODate());
  const [note, setNote] = useState('');

  const total = quantity * unitPrice;

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Member', value: picked ? `${picked.full_name} (${picked.member_no})` : '—' },
      { label: 'Shares', value: `${quantity} × ${formatUGX(unitPrice)}` },
      { label: 'Total to pay', value: formatUGX(total), emphasis: true },
      ...(currentShares !== undefined
        ? [
            {
              label: 'Shares after purchase',
              value: `${currentShares + quantity} (${formatUGX(
                (currentShares + quantity) * unitPrice,
              )})`,
            },
          ]
        : []),
      { label: 'Payment method', value: PAYMENT_METHOD_LABELS[method] },
      { label: 'Purchase date', value: formatDate(purchasedOn) },
    ];
  }

  return (
    <FinancialForm
      action={buyShares}
      idempotencyPrefix="shares"
      submitLabel="Record purchase"
      pendingLabel="Recording…"
      successTitle="Shares purchased"
      amount={() => total}
      summary={summary}
      canConfirm={!!picked && quantity > 0}
      doneHref={doneHref}
      doneLabel="Back"
      receiptHref={(r) =>
        r.transaction_id ? `/staff/transactions/${r.transaction_id}` : null
      }
      validate={() => {
        if (!picked) return 'Choose the member buying shares.';
        if (!Number.isInteger(quantity) || quantity < 1)
          return 'Enter a whole number of shares, at least 1.';
        return null;
      }}
    >
      <div className="flex flex-col gap-5">
        {/* What the counter was shown, for the database to check its own
            arithmetic against. It cannot decide the price. */}
        <input type="hidden" name="expected_total" value={String(total)} />

        {lockMember && picked ? (
          <input type="hidden" name="member_id" value={picked.id} />
        ) : (
          <MemberPicker name="member_id" initial={picked} onSelect={setPicked} />
        )}

        <Field
          label="Number of shares"
          htmlFor="quantity"
          required
          hint={`Each share costs ${formatUGX(unitPrice)}. Buy any number you like.`}
        >
          <div className="flex items-stretch gap-2">
            <Button
              variant="outline"
              size="lg"
              aria-label="One fewer share"
              className="w-14 shrink-0 px-0"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              icon="remove"
            />
            <Input
              id="quantity"
              name="quantity"
              type="text"
              inputMode="numeric"
              value={String(quantity)}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^\d]/g, '');
                setQuantity(digits ? Math.min(Number(digits), 100000) : 0);
              }}
              className="tabular flex-1 text-center text-xl font-bold"
              required
            />
            <Button
              variant="outline"
              size="lg"
              aria-label="One more share"
              className="w-14 shrink-0 px-0"
              onClick={() => setQuantity((q) => Math.min(100000, q + 1))}
              icon="add"
            />
          </div>
        </Field>

        <div className="-mt-2 flex flex-wrap gap-2">
          {picks.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setQuantity(n)}
              className={`text-label-md font-label-md h-touch-target-min rounded-full px-4 normal-case transition-colors ${
                quantity === n
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {n} {n === 1 ? 'share' : 'shares'}
            </button>
          ))}
        </div>

        {/* Running total — the member is told the price before they commit. */}
        <div className="bg-secondary-container text-on-secondary-container flex items-center justify-between rounded-xl p-4">
          <div>
            <p className="text-label-md font-label-md">Total value</p>
            <p className="text-body-md font-body-md">
              {quantity} × {formatUGX(unitPrice)}
            </p>
          </div>
          <Money value={total} className="text-headline-lg-mobile font-headline-lg-mobile" />
        </div>

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

        <Field label="Purchase date" htmlFor="purchased_on" required>
          <Input
            id="purchased_on"
            name="purchased_on"
            type="date"
            value={purchasedOn}
            max={toISODate()}
            onChange={(e) => setPurchasedOn(e.target.value)}
            required
          />
        </Field>

        <Field label="Note" htmlFor="note" hint="Optional — appears on the receipt.">
          <Textarea
            id="note"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="e.g. Annual share top-up"
          />
        </Field>
      </div>
    </FinancialForm>
  );
}
