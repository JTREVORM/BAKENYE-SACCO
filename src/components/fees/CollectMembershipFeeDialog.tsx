'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { collectMembershipFee } from '@/app/actions/fees';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { ActionForm } from '@/components/forms/ActionForm';
import { useSubmission } from '@/components/forms/useSubmission';
import { UnresolvedSubmission } from '@/components/forms/UnresolvedSubmission';
import { Button, Field, Input, MoneyInput, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { newIdempotencyKey } from '@/lib/errors';
import { RECEIVING_LABEL, methodForAccount, receivingAccountLabel } from '@/lib/receiving-accounts';
import type { CollectionAccount, FeePaymentResult } from '@/types/access';

/**
 * Take a membership fee payment, whole or in part.
 *
 * The amount field starts at the balance, because that is what most members
 * bring, but it is an ordinary field: a cashier types what the member actually
 * handed over. The one thing the form will not do is take more than is owed —
 * and it is the database that refuses it, not this dialog. What is shown here
 * is only so the cashier finds out before the member has queued.
 */
export function CollectMembershipFeeDialog({
  memberId,
  memberName,
  required,
  paid,
  outstanding,
  accounts,
  onClose,
}: {
  memberId: string;
  memberName: string;
  required: number;
  paid: number;
  outstanding: number;
  accounts: CollectionAccount[];
  onClose: () => void;
}) {
  const submission = useSubmission<FeePaymentResult>(collectMembershipFee);
  const state = submission.result;
  const [amount, setAmount] = useState(String(outstanding));
  const [accountId, setAccountId] = useState(
    (accounts.find((a) => a.account_type === 'cash' && a.is_default) ?? accounts[0])?.id ?? '',
  );
  const key = useRef(newIdempotencyKey('memfee'));
  const err = state && !state.ok ? state : null;

  const account = accounts.find((a) => a.id === accountId);
  const typed = Number(amount);
  const valid = Number.isFinite(typed) && typed > 0 && typed <= outstanding;
  const left = valid ? outstanding - typed : outstanding;

  if (submission.unresolved) {
    return (
      <Modal open onClose={onClose} title="Fee not confirmed">
        <UnresolvedSubmission
          busy={submission.busy}
          onRecheck={submission.recheck}
          onClose={onClose}
          noun="payment"
        />
      </Modal>
    );
  }

  if (state?.ok) {
    return (
      <Modal open onClose={onClose} title="Membership fee recorded">
        <div className="flex flex-col gap-4">
          <Alert tone="success" title={`${formatUGX(state.data.amount)} received`}>
            Receipt {state.data.receipt_no ?? state.data.reference}
            {state.data.account_name ? ` · into ${state.data.account_name}` : ''}
          </Alert>
          <Link
            href={`/staff/transactions/${state.data.transaction_id}`}
            className="bg-ink h-touch-target-primary text-button-text flex items-center justify-center rounded-full font-semibold text-white shadow-neu-dark"
          >
            View &amp; print receipt
          </Link>
          <Button variant="outline" size="lg" block onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Collect membership fee"
      description={`${memberName} — ${formatUGX(outstanding)} outstanding`}
    >
      <ActionForm submission={submission} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="member_id" value={memberId} />
        <input type="hidden" name="account_id" value={accountId} />
        <input type="hidden" name="idempotency_key" value={key.current} />
        {/* Derived from the chosen account by the one shared rule, never asked
            for separately. */}
        <input type="hidden" name="method" value={methodForAccount(account)} />
        {err && !['amount', 'reference', 'account_id'].includes(err.field ?? '') ? (
          <Alert tone="error">{err.error}</Alert>
        ) : null}

        {/* Where the member stands, before anything is taken. */}
        <dl className="bg-surface-container grid grid-cols-3 gap-2 rounded-2xl p-3 shadow-neu-inset-sm">
          <Stat label="Required" value={required} />
          <Stat label="Already paid" value={paid} />
          <Stat label="Balance" value={outstanding} tone="text-primary" />
        </dl>

        <Field
          label="Amount received"
          htmlFor="memfee-amount"
          required
          error={err?.field === 'amount' ? err.error : null}
          hint={`Any amount up to ${formatUGX(outstanding)}. Part payments are fine.`}
        >
          <MoneyInput
            id="memfee-amount"
            name="amount"
            value={amount}
            onValueChange={(v) => setAmount(v == null ? '' : String(v))}
            autoFocus
          />
        </Field>

        {typed > outstanding ? (
          <Alert tone="warning">
            That is more than is owed. The balance is {formatUGX(outstanding)}.
          </Alert>
        ) : valid && left > 0 ? (
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            {formatUGX(left)} would still be outstanding after this payment.
          </p>
        ) : valid && left === 0 ? (
          <p className="text-label-md font-label-md text-tertiary normal-case">
            This settles the membership fee in full.
          </p>
        ) : null}

        {accounts.length === 0 ? (
          <Alert tone="warning">
            No receiving accounts are set up. A manager adds them under Finance → Accounts &amp;
            Setup.
          </Alert>
        ) : (
          <Field
            label={RECEIVING_LABEL}
            htmlFor="memfee-account"
            required
            error={err?.field === 'account_id' ? err.error : null}
          >
            <Select
              id="memfee-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {receivingAccountLabel(a)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Reference"
          htmlFor="memfee-ref"
          required={account?.account_type === 'merchant' || account?.account_type === 'bank'}
          error={err?.field === 'reference' ? err.error : null}
          hint={
            account?.account_type === 'merchant'
              ? 'The transaction ID from the mobile money confirmation.'
              : account?.account_type === 'bank'
                ? 'The deposit slip or transfer reference.'
                : 'Optional for cash.'
          }
        >
          <Input id="memfee-ref" name="reference" maxLength={80} />
        </Field>

        <Field label="Date received" htmlFor="memfee-date">
          <Input id="memfee-date" name="paid_on" type="date" defaultValue={toISODate(new Date())} />
        </Field>

        <Field label="Note" htmlFor="memfee-note" hint="Optional. Appears on the audit entry.">
          <Textarea id="memfee-note" name="note" rows={2} maxLength={300} />
        </Field>

        <div className="flex flex-col gap-2">
          <SubmitButton size="lg" block disabled={!valid || accounts.length === 0}>
            Record payment
          </SubmitButton>
          <Button variant="ghost" size="lg" block onClick={onClose} type="button">
            Cancel
          </Button>
        </div>
      </ActionForm>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate normal-case">
        {label}
      </dt>
      <dd className={`text-body-md tabular truncate font-bold ${tone ?? 'text-on-surface'}`}>
        {formatUGX(value)}
      </dd>
    </div>
  );
}
