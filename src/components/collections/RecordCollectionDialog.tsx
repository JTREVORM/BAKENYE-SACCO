'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { recordMemberCollection } from '@/app/actions/treasury';
import {
  ReceivingAccountFields,
  useReceivingAccount,
} from '@/components/forms/ReceivingAccountField';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Avatar, Icon, Money } from '@/components/ui/primitives';
import {
  Button,
  Field,
  Input,
  MoneyInput,
  Textarea,
} from '@/components/ui/form';
import { useSubmission } from '@/components/forms/useSubmission';
import { ActionForm } from '@/components/forms/ActionForm';
import { UnresolvedSubmission } from '@/components/forms/UnresolvedSubmission';
import { newIdempotencyKey } from '@/lib/errors';
import { formatUGX, toNumber } from '@/lib/money';
import { formatDate, toISODate } from '@/lib/format';
import { RECEIVING_LABEL } from '@/lib/receiving-accounts';
import { clsx } from '@/lib/clsx';
import type { CollectionAccount } from '@/types/access';
import type { MemberCollectionResult } from '@/types/treasury';
import type { SavingsScheduleRow } from '@/types/db';

/**
 * Record one savings deposit for a member.
 *
 * Three steps, same as every other money movement in this application: fill in,
 * confirm the amount and the member, then post. The submit control is disabled
 * while the action is in flight and a stable idempotency key rides along, so a
 * double tap on a patchy connection settles into one ledger row.
 *
 * The outcome is awaited through `useSubmission` rather than published by
 * `useActionState`, because certification caught savings reaching the ledger
 * while this dialog showed nothing at all. A lost answer now has its own
 * screen, and keeps the submission's key so it can be asked about rather than
 * entered again.
 *
 * Choosing a merchant or bank account here means *a transfer that already
 * happened*. Nothing in this dialog contacts MTN, Airtel or any gateway; the
 * reference field is where the staff member types the confirmation code from the
 * handset so the entry can be reconciled later.
 */
export function RecordCollectionDialog({
  row,
  memberId,
  accounts,
  open,
  onClose,
}: {
  row: SavingsScheduleRow | null;
  memberId: string;
  /** The SACCO's active receiving accounts, from `collection_accounts()`. */
  accounts: CollectionAccount[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const submission = useSubmission<MemberCollectionResult>(recordMemberCollection);
  const state = submission.result;

  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(toISODate());
  const [clientError, setClientError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('collect'));
  const into = useReceivingAccount(accounts);

  // Re-arm the dialog whenever it opens on a different member. The amount
  // starts empty on purpose: savings are open, so the member says what they
  // want to save and nothing here may suggest a figure to them.
  useEffect(() => {
    if (!open || !row) return;
    setConfirming(false);
    setClientError(null);
    setAmount(null);
    into.setReference('');
    setPaidOn(toISODate());
    setIdemKey(newIdempotencyKey('collect'));
    submission.reset();
    // `into` is re-created every render; only its setter is used here, and that
    // setter is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row]);

  useEffect(() => {
    if (!state) return;
    setConfirming(false);
    // A new key only once the ledger is known to hold this one. An unresolved
    // submission keeps its key, so re-sending it asks about the entry that may
    // already exist instead of making a second one.
    if (state.ok) {
      setIdemKey(newIdempotencyKey('collect'));
      // Best effort: the panel behind this dialog is stale now. The dialog
      // states the outcome itself and does not wait on this.
      router.refresh();
    }
  }, [state, router]);

  if (!row) return null;

  /* --------------------------------------------------- answer never came */
  if (submission.unresolved) {
    return (
      <Modal open={open} onClose={onClose} title="Savings not confirmed">
        <UnresolvedSubmission
          busy={submission.busy}
          onRecheck={submission.recheck}
          onClose={onClose}
          noun="payment"
        />
      </Modal>
    );
  }

  const savedThisMonth = toNumber(row.saved_amount);
  const monthAfter = savedThisMonth + (amount ?? 0);

  function validate(): string | null {
    if (!amount || amount <= 0) return 'Enter the amount received.';
    if (paidOn > toISODate()) return 'A payment cannot be dated in the future.';
    return into.validate();
  }

  /* ------------------------------------------------------------------ done */
  if (state?.ok) {
    return (
      <Modal open={open} onClose={onClose} title="Savings recorded">
        <div className="animate-slide-up flex flex-col items-center py-4 text-center">
          <div className="bg-tertiary-container mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <Icon name="check_circle" size={36} className="text-white" />
          </div>
          <p className="text-body-lg font-body-lg text-on-surface font-semibold">
            {state.data.member_name}
          </p>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            {state.message}
          </p>

          <dl className="bg-surface-container-low divide-outline-variant/70 mt-5 w-full divide-y rounded-xl px-4 shadow-neu-sm">
            <Line label="Reference" value={<span className="tabular font-mono">{state.data.reference}</span>} />
            <Line label="Month" value={state.data.period_label ?? '—'} />
            <Line label="Saved this month" value={<Money value={state.data.period_total ?? 0} />} />
            <Line label={RECEIVING_LABEL} value={state.data.account_name} />
          </dl>

          <div className="mt-6 flex w-full flex-col gap-3">
            <Link
              href={`/staff/transactions/${state.data.transaction_id}`}
              className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text flex items-center justify-center gap-2 rounded-lg font-semibold"
            >
              <Icon name="receipt_long" size={20} />
              View receipt
            </Link>
            <Button variant="outline" size="lg" onClick={onClose}>
              Back to the member
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  /* ------------------------------------------------------------- edit form */
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={confirming ? 'Confirm these savings' : 'Record savings'}
      description={confirming ? undefined : `${row.member_name} · ${row.period_label}`}
    >
      <ActionForm
        submission={submission}
        noValidate
        // Nothing posts from the editing step, whatever reaches this form.
        guard={() => confirming}
      >
        <input type="hidden" name="collection_type" value="savings" />
        {/* The month this screen is settling, so a payment dated in another
            month still lands on the row the cashier opened. */}
        <input type="hidden" name="period_id" value={row.period_id} />
        <input type="hidden" name="member_id" value={memberId} />
        <input type="hidden" name="idempotency_key" value={idemKey} />

        {state && !state.ok ? (
          <div className="mb-4">
            <Alert tone="error" title="Payment not recorded">
              {state.error}
            </Alert>
          </div>
        ) : null}
        {clientError ? (
          <div className="mb-4">
            <Alert tone="error">{clientError}</Alert>
          </div>
        ) : null}

        {/* Fields stay mounted through the confirmation step so nothing typed
            is lost on the way back. */}
        <div className={clsx('flex flex-col gap-5', confirming && 'hidden')}>
          <div className="bg-surface-container-low flex items-center gap-3 rounded-xl p-3 shadow-neu-sm">
            <Avatar name={row.member_name} src={row.member_photo} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                {row.member_name}
              </p>
              <p className="text-label-md font-label-md text-on-surface-variant tabular truncate normal-case">
                {row.member_no}
                {savedThisMonth > 0
                  ? ` · ${formatUGX(savedThisMonth)} saved so far in ${row.period_label}`
                  : ` · nothing saved yet in ${row.period_label}`}
              </p>
            </div>
          </div>

          <Field
            label="Amount received"
            htmlFor="collect-amount"
            required
            hint="Any amount the member chooses. There is no monthly target."
          >
            <MoneyInput
              id="collect-amount"
              name="amount"
              value={amount ?? ''}
              onValueChange={setAmount}
              required
              autoFocus
              enterKeyHint="next"
            />
          </Field>

          <ReceivingAccountFields state={into} idPrefix="collect" />

          <Field label="Payment date" htmlFor="collect-date" required>
            <Input
              id="collect-date"
              name="paid_on"
              type="date"
              value={paidOn}
              max={toISODate()}
              onChange={(e) => setPaidOn(e.target.value)}
              required
            />
          </Field>

          <Field label="Note" htmlFor="collect-note">
            <Textarea id="collect-note" name="notes" maxLength={500} rows={2} />
          </Field>
        </div>

        {/* ------------------------------------------------------- confirm */}
        {confirming ? (
          <div className="animate-slide-up">
            <div className="bg-primary text-on-primary relative mb-5 overflow-hidden rounded-xl p-5 text-center">
              <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
              <p className="text-label-md font-label-md text-primary-fixed-dim relative z-10">
                Recording for {row.member_name}
              </p>
              <Money
                value={amount}
                className="text-display-currency font-display-currency relative z-10 mt-1 block"
              />
            </div>

            <dl className="bg-surface divide-outline-variant/70 mb-5 divide-y rounded-xl px-4 shadow-neu-sm">
              <Line label="Member" value={`${row.member_name} (${row.member_no})`} />
              <Line label="Month" value={row.period_label} />
              <Line label={RECEIVING_LABEL} value={into.label} />
              {into.reference.trim() ? (
                <Line
                  label="Reference"
                  value={<span className="tabular">{into.reference.trim()}</span>}
                />
              ) : null}
              <Line label="Payment date" value={formatDate(paidOn)} />
              <Line label="Saved this month after this" value={<Money value={monthAfter} />} />
            </dl>

            <Alert tone="warning">
              Check these details. Once recorded, a payment can only be corrected by a reversal.
            </Alert>
          </div>
        ) : null}

        <div className="mt-5 flex gap-3">
          {confirming ? (
            <>
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                icon="arrow_back"
                onClick={() => setConfirming(false)}
              >
                Back
              </Button>
              <Button
                key="post"
                type="submit"
                size="lg"
                className="flex-[2]"
                icon="check"
                loading={submission.busy}
              >
                {submission.busy ? 'Recording…' : 'Record savings'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                key="review"
                size="lg"
                className="flex-[2]"
                iconEnd="arrow_forward"
                onClick={() => {
                  const message = validate();
                  setClientError(message);
                  if (!message) setConfirming(true);
                }}
              >
                Review
              </Button>
            </>
          )}
        </div>
      </ActionForm>
    </Modal>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-body-md font-body-md text-on-surface-variant shrink-0">{label}</dt>
      <dd
        className={clsx(
          'text-body-md font-body-md min-w-0 text-right font-semibold',
          tone ?? 'text-on-surface',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
