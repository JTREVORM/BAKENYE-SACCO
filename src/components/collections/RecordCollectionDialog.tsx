'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { recordCollection, type CollectionResult } from '@/app/actions/collections';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Avatar, Icon, Money } from '@/components/ui/primitives';
import {
  Button,
  Field,
  Input,
  MoneyInput,
  Select,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { newIdempotencyKey, type ActionResult } from '@/lib/errors';
import { formatUGX, toNumber } from '@/lib/money';
import { formatDate, PAYMENT_METHOD_LABELS, toISODate } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { PaymentMethod, SavingsScheduleRow } from '@/types/db';

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank_transfer', 'cheque'];

/** Methods that happened somewhere else and therefore need a reference. */
const NEEDS_REFERENCE: PaymentMethod[] = ['mobile_money', 'bank_transfer'];

/**
 * Record one contribution on a collection day.
 *
 * Three steps, same as every other money movement in this application: fill in,
 * confirm the amount and the member, then post. The submit control is disabled
 * while the action is in flight and a stable idempotency key rides along, so a
 * double tap on a patchy connection settles into one ledger row.
 *
 * "Mobile Money" here means *a transfer that already happened*. Nothing in this
 * dialog contacts MTN, Airtel or any gateway; the reference field is where the
 * staff member types the confirmation code from the handset so the entry can be
 * reconciled later.
 */
export function RecordCollectionDialog({
  row,
  groupId,
  open,
  onClose,
}: {
  row: SavingsScheduleRow | null;
  groupId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<CollectionResult> | null, FormData>(
    recordCollection,
    null,
  );

  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(toISODate());
  const [clientError, setClientError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('collect'));

  const outstanding = row ? toNumber(row.outstanding) : 0;

  // Re-arm the dialog whenever it opens on a different member.
  useEffect(() => {
    if (!open || !row) return;
    setConfirming(false);
    setClientError(null);
    setAmount(outstanding > 0 ? outstanding : toNumber(row.expected_amount) || null);
    setMethod('cash');
    setReference('');
    setPaidOn(toISODate());
    setIdemKey(newIdempotencyKey('collect'));
  }, [open, row, outstanding]);

  useEffect(() => {
    if (state?.ok) {
      setConfirming(false);
      setIdemKey(newIdempotencyKey('collect'));
      router.refresh();
    } else if (state && !state.ok) {
      setConfirming(false);
    }
  }, [state, router]);

  if (!row) return null;

  const expected = toNumber(row.expected_amount);
  const alreadyPaid = toNumber(row.paid_amount);
  const willOwe = Math.max(expected - alreadyPaid - (amount ?? 0), 0);

  function validate(): string | null {
    if (!amount || amount <= 0) return 'Enter the amount received.';
    if (NEEDS_REFERENCE.includes(method) && !reference.trim()) {
      return method === 'mobile_money'
        ? 'Enter the mobile money transaction reference from the confirmation message.'
        : 'Enter the bank transfer or deposit slip reference.';
    }
    if (paidOn > toISODate()) return 'A payment cannot be dated in the future.';
    return null;
  }

  /* ------------------------------------------------------------------ done */
  if (state?.ok) {
    const settled = toNumber(state.data.outstanding) === 0;
    return (
      <Modal open={open} onClose={onClose} title="Payment recorded">
        <div className="animate-slide-up flex flex-col items-center py-4 text-center">
          <div
            className={clsx(
              'mb-4 flex h-16 w-16 items-center justify-center rounded-full',
              settled ? 'bg-tertiary-container' : 'bg-secondary-container',
            )}
          >
            <Icon
              name={settled ? 'check_circle' : 'pending'}
              size={36}
              className={settled ? 'text-white' : 'text-on-secondary-container'}
            />
          </div>
          <p className="text-body-lg font-body-lg text-on-surface font-semibold">
            {state.data.member_name}
          </p>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            {state.message}
          </p>

          <dl className="bg-surface-container-low divide-outline-variant/70 mt-5 w-full divide-y rounded-xl px-4 shadow-neu-sm">
            <Line label="Reference" value={<span className="tabular font-mono">{state.data.reference}</span>} />
            <Line label="Cycle" value={state.data.period_label} />
            <Line label="Expected" value={<Money value={state.data.expected} />} />
            <Line label="Paid so far" value={<Money value={state.data.paid} />} />
            <Line
              label="Outstanding"
              value={<Money value={state.data.outstanding} />}
              tone={settled ? undefined : 'text-error'}
            />
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
              Back to the sheet
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
      title={confirming ? 'Confirm this payment' : 'Record payment'}
      description={confirming ? undefined : `${row.member_name} · ${row.period_label}`}
    >
      <form action={formAction} noValidate>
        <input type="hidden" name="schedule_id" value={row.schedule_id} />
        <input type="hidden" name="group_id" value={groupId} />
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
                {row.member_no} · expected {formatUGX(expected)}
                {alreadyPaid > 0 ? ` · already paid ${formatUGX(alreadyPaid)}` : ''}
              </p>
            </div>
          </div>

          <Field
            label="Amount received"
            htmlFor="collect-amount"
            required
            hint={
              outstanding > 0
                ? `Outstanding for this cycle is ${formatUGX(outstanding)}.`
                : 'This cycle is already settled — anything recorded now is extra.'
            }
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

          {outstanding > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Chip label={`Full ${formatUGX(outstanding)}`} onClick={() => setAmount(outstanding)} />
              {outstanding >= 2 ? (
                <Chip
                  label={`Half ${formatUGX(Math.round(outstanding / 2))}`}
                  onClick={() => setAmount(Math.round(outstanding / 2))}
                />
              ) : null}
            </div>
          ) : null}

          <Field label="Payment method" htmlFor="collect-method" required>
            <Select
              id="collect-method"
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

          {NEEDS_REFERENCE.includes(method) ? (
            <Alert tone="info">
              This records a transfer that has already been received. Type the reference from the
              confirmation message so it can be reconciled against the statement.
            </Alert>
          ) : null}

          <Field
            label={NEEDS_REFERENCE.includes(method) ? 'Transaction reference' : 'Receipt reference'}
            htmlFor="collect-ref"
            required={NEEDS_REFERENCE.includes(method)}
            hint="Must be unique — the same reference cannot be banked twice."
          >
            <Input
              id="collect-ref"
              name="external_ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={method === 'mobile_money' ? 'e.g. 1234567890' : 'Optional'}
              maxLength={80}
              autoComplete="off"
              className="tabular"
            />
          </Field>

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
            <Textarea id="collect-note" name="note" maxLength={500} rows={2} />
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
              <Line label="Cycle" value={row.period_label} />
              <Line label="Expected" value={<Money value={expected} />} />
              <Line label="Payment method" value={PAYMENT_METHOD_LABELS[method]} />
              {reference.trim() ? (
                <Line label="Reference" value={<span className="tabular">{reference.trim()}</span>} />
              ) : null}
              <Line label="Payment date" value={formatDate(paidOn)} />
              <Line
                label="Still outstanding after this"
                value={<Money value={willOwe} />}
                tone={willOwe > 0 ? 'text-error' : undefined}
              />
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
              <SubmitButton size="lg" className="flex-[2]" pendingLabel="Recording…" icon="check">
                Record payment
              </SubmitButton>
            </>
          ) : (
            <>
              <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
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
      </form>
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

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-surface-container text-on-surface-variant hover:bg-surface-container-high text-label-md font-label-md h-touch-target-min rounded-full px-4 normal-case transition-colors"
    >
      {label}
    </button>
  );
}
