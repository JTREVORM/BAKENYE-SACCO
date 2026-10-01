'use client';

import { useState } from 'react';
import { recordMemberCollection } from '@/app/actions/treasury';
import { FinancialForm, type FinancialSummaryLine } from './FinancialForm';
import { MemberPicker, type PickedMember } from './MemberPicker';
import { ReceivingAccountFields, useReceivingAccount } from './ReceivingAccountField';
import { Field, Input, MoneyInput, Textarea } from '@/components/ui/form';
import { Money } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { formatUGX } from '@/lib/money';
import { formatDate, toISODate } from '@/lib/format';
import { PAYING_LABEL, RECEIVING_LABEL } from '@/lib/receiving-accounts';
import type { CollectionAccount } from '@/types/access';

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
 *
 * A deposit names the account it is received into; a withdrawal names the
 * account the money is paid out of. Either way it is one of the SACCO's own
 * configured accounts, and that account is the one the ledger moves.
 */
export function CashMovementForm({
  type,
  member,
  lockMember = false,
  availableBalance,
  accounts,
  doneHref,
}: {
  type: 'deposit' | 'withdrawal';
  member?: PickedMember | null;
  lockMember?: boolean;
  availableBalance?: number;
  /** The SACCO's active accounts, from `collection_accounts()`. */
  accounts: CollectionAccount[];
  doneHref?: string;
}) {
  const isWithdrawal = type === 'withdrawal';
  const [picked, setPicked] = useState<PickedMember | null>(member ?? null);
  const [amount, setAmount] = useState<number | null>(null);
  const [occurredOn, setOccurredOn] = useState(toISODate());
  const [description, setDescription] = useState('');
  const through = useReceivingAccount(accounts, isWithdrawal ? 'out' : 'in');

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
      { label: isWithdrawal ? PAYING_LABEL : RECEIVING_LABEL, value: through.label },
      ...(through.reference.trim()
        ? [{ label: 'Reference', value: through.reference.trim() }]
        : []),
      { label: 'Date', value: formatDate(occurredOn) },
      ...(description ? [{ label: 'Note', value: description }] : []),
    ];
  }

  return (
    <FinancialForm
      action={recordMemberCollection}
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
      canConfirm={!!picked && !!amount && !exceeds && !!through.accountId}
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
        return through.validate();
      }}
    >
      <input type="hidden" name="collection_type" value={type} />

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

        <ReceivingAccountFields
          state={through}
          idPrefix={type}
          direction={isWithdrawal ? 'out' : 'in'}
        />

        <Field label="Date" htmlFor="occurred_on" required>
          <Input
            id="occurred_on"
            name="paid_on"
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
            Confirm the member&rsquo;s identity before paying out. Withdrawals are recorded against their
            savings only.
          </Alert>
        ) : null}
      </div>
    </FinancialForm>
  );
}
