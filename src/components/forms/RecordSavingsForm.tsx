'use client';

import { useState } from 'react';
import { recordMemberCollection } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { MemberPicker, type PickedMember } from './MemberPicker';
import { ReceivingAccountFields, useReceivingAccount } from './ReceivingAccountField';
import { Field, MoneyInput, Input } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import { formatDate, toISODate } from '@/lib/format';
import { RECEIVING_LABEL } from '@/lib/receiving-accounts';
import type { CollectionAccount } from '@/types/access';

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
 *
 * Where the money went is not a method but an account: the cashier picks one of
 * the SACCO's own active accounts and the ledger credits that exact account.
 */
export function RecordSavingsForm({
  member,
  lockMember = false,
  accounts,
  doneHref,
}: {
  member?: PickedMember | null;
  lockMember?: boolean;
  /** The SACCO's active receiving accounts, from `collection_accounts()`. */
  accounts: CollectionAccount[];
  doneHref?: string;
}) {
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const [amount, setAmount] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(toISODate());
  const into = useReceivingAccount(accounts);

  function summary(): FinancialSummaryLine[] {
    return [
      { label: 'Member', value: picked ? `${picked.full_name} (${picked.member_no})` : '—' },
      { label: 'Amount', value: formatUGX(amount), emphasis: true },
      { label: RECEIVING_LABEL, value: into.label },
      ...(into.reference.trim()
        ? [{ label: 'Reference', value: into.reference.trim() }]
        : []),
      { label: 'Payment date', value: formatDate(paidOn) },
    ];
  }

  return (
    <FinancialForm
      action={recordMemberCollection}
      idempotencyPrefix="savings"
      submitLabel="Record savings"
      pendingLabel="Recording…"
      successTitle="Savings recorded"
      amount={() => amount}
      summary={summary}
      canConfirm={!!picked && !!amount && !!into.accountId}
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
        return into.validate();
      }}
    >
      <input type="hidden" name="collection_type" value="savings" />

      <div className="flex flex-col gap-5">
        {lockMember && picked ? (
          <input type="hidden" name="member_id" value={picked.id} />
        ) : (
          <MemberPicker name="member_id" initial={picked} onSelect={setPicked} />
        )}

        {/* Savings are monthly. The cadence is no longer a choice at the
            counter: `weekly` survives only on records raised before the rules
            changed. */}
        <input type="hidden" name="savings_kind" value="monthly" />

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

        <ReceivingAccountFields state={into} idPrefix="savings" />

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
