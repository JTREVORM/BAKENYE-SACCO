'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { chargeMemberFee, payMemberFees, waiveMemberFee } from '@/app/actions/fees';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Button, Field, Input, MoneyInput, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { newIdempotencyKey, type ActionResult } from '@/lib/errors';
import type { CollectionAccount, FeePaymentResult, MemberFeeRow } from '@/types/access';

type ChargeableFee = { id: string; name: string; amount: number };

/**
 * The actions on a member's fees: record a payment of what they owe, charge a
 * fee that applies to existing members, or waive an unpaid one. Each button
 * appears only for someone whose role allows it, and the database checks again.
 */
export function MemberFeeActions({
  memberId,
  unpaid,
  chargeable,
  accounts,
  canCollect,
  canWaive,
}: {
  memberId: string;
  unpaid: MemberFeeRow[];
  chargeable: ChargeableFee[];
  accounts: CollectionAccount[];
  canCollect: boolean;
  canWaive: boolean;
}) {
  const [dialog, setDialog] = useState<null | 'pay' | 'charge' | { waive: MemberFeeRow }>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canCollect && unpaid.length > 0 ? (
          <Button size="sm" icon="payments" onClick={() => setDialog('pay')}>
            Record payment
          </Button>
        ) : null}
        {canCollect && chargeable.length > 0 ? (
          <Button size="sm" variant="outline" icon="add" onClick={() => setDialog('charge')}>
            Charge a fee
          </Button>
        ) : null}
      </div>

      {canWaive && unpaid.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {unpaid.map((c) => (
            <li key={c.id}>
              <Button size="sm" variant="ghost" icon="block" onClick={() => setDialog({ waive: c })}>
                Waive {c.fee_name}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {dialog === 'pay' ? (
        <PayDialog memberId={memberId} unpaid={unpaid} accounts={accounts} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'charge' ? (
        <ChargeDialog memberId={memberId} fees={chargeable} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <WaiveDialog memberId={memberId} charge={dialog.waive} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function PayDialog({
  memberId,
  unpaid,
  accounts,
  onClose,
}: {
  memberId: string;
  unpaid: MemberFeeRow[];
  accounts: CollectionAccount[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionResult<FeePaymentResult> | null, FormData>(payMemberFees, null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(unpaid.map((c) => c.id)));
  const [accountId, setAccountId] = useState(
    (accounts.find((a) => a.account_type === 'cash' && a.is_default) ?? accounts[0])?.id ?? '',
  );
  const key = useRef(newIdempotencyKey('fees'));
  const err = state && !state.ok ? state : null;

  const total = useMemo(
    () => unpaid.filter((c) => chosen.has(c.id)).reduce((s, c) => s + Number(c.amount), 0),
    [unpaid, chosen],
  );
  const account = accounts.find((a) => a.id === accountId);

  if (state?.ok) {
    return (
      <Modal open onClose={onClose} title="Payment recorded">
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
    <Modal open onClose={onClose} title="Record a fee payment" description="One receipt for everything ticked.">
      <form action={action} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="member_id" value={memberId} />
        <input type="hidden" name="charge_ids" value={[...chosen].join(',')} />
        <input type="hidden" name="account_id" value={accountId} />
        <input type="hidden" name="idempotency_key" value={key.current} />
        <input
          type="hidden"
          name="method"
          value={account?.account_type === 'cash' ? 'cash' : account?.account_type === 'merchant' ? 'mobile_money' : account ? 'bank_transfer' : ''}
        />
        {err && !['reference', 'amount_received', 'account_id'].includes(err.field ?? '') ? <Alert tone="error">{err.error}</Alert> : null}

        <ul className="flex flex-col gap-2">
          {unpaid.map((c) => (
            <li key={c.id}>
              <label className="bg-surface-container flex cursor-pointer items-center gap-3 rounded-2xl p-3 shadow-neu-inset-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(c.id)}
                  onChange={(e) =>
                    setChosen((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(c.id);
                      else n.delete(c.id);
                      return n;
                    })
                  }
                  className="text-primary focus:ring-primary border-outline h-5 w-5 rounded"
                />
                <span className="text-body-md text-on-surface flex-1 font-semibold">{c.fee_name}</span>
                <span className="tabular text-body-md font-semibold">{formatUGX(c.amount)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-body-lg text-on-surface flex justify-between font-bold">
          <span>Total</span>
          <span className="tabular">{formatUGX(total)}</span>
        </p>

        {accounts.length === 0 ? (
          <Alert tone="warning">No receiving accounts are set up. A manager adds them under Finance → Accounts &amp; Setup.</Alert>
        ) : (
          <Field label="Received into" htmlFor="pay-account" required error={err?.field === 'account_id' ? err.error : null}>
            <Select id="pay-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.account_type === 'merchant' ? ' (mobile money)' : a.account_type === 'bank' ? ' (bank)' : ' (cash)'}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {account && account.account_type !== 'cash' ? (
          <Field
            label={account.account_type === 'merchant' ? 'Mobile money reference' : 'Bank reference or slip number'}
            htmlFor="pay-ref"
            required
            error={err?.field === 'reference' ? err.error : null}
          >
            <Input id="pay-ref" name="reference" className="tabular" autoCapitalize="characters" spellCheck={false} />
          </Field>
        ) : null}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Amount received" htmlFor="pay-amount" required error={err?.field === 'amount_received' ? err.error : null} hint={`Must equal ${formatUGX(total)}.`}>
            <MoneyInput id="pay-amount" name="amount_received" />
          </Field>
          <Field label="Date paid" htmlFor="pay-date">
            <Input id="pay-date" name="paid_on" type="date" max={toISODate()} defaultValue={toISODate()} />
          </Field>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton size="lg" className="flex-1" disabled={chosen.size === 0 || !accountId} pendingLabel="Recording…">
            Record {formatUGX(total)}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function ChargeDialog({
  memberId,
  fees,
  onClose,
}: {
  memberId: string;
  fees: ChargeableFee[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionResult<MemberFeeRow> | null, FormData>(chargeMemberFee, null);
  const err = state && !state.ok ? state : null;
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal open onClose={onClose} title="Charge a fee" description="The amount is the fee's current amount, from Settings → Fees.">
      <form action={action} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="member_id" value={memberId} />
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
        <Field label="Fee" htmlFor="charge-fee" required error={err?.field === 'fee_id' ? err.error : null}>
          <Select id="charge-fee" name="fee_id" defaultValue={fees[0]?.id}>
            {fees.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {formatUGX(f.amount)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What is it for?" htmlFor="charge-reason" required error={err?.field === 'reason' ? err.error : null}>
          <Input id="charge-reason" name="reason" maxLength={300} placeholder="e.g. Replacement passbook - the old one was lost." />
        </Field>
        <div className="flex gap-3">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton size="lg" className="flex-1" pendingLabel="Charging…">
            Charge fee
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function WaiveDialog({
  memberId,
  charge,
  onClose,
}: {
  memberId: string;
  charge: MemberFeeRow;
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionResult<MemberFeeRow> | null, FormData>(waiveMemberFee, null);
  const err = state && !state.ok ? state : null;
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Waive ${charge.fee_name}`}
      description={`${formatUGX(charge.amount)} will no longer be owed. The charge and the waiver both stay on the record.`}
    >
      <form action={action} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="member_id" value={memberId} />
        <input type="hidden" name="charge_id" value={charge.id} />
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
        <Field label="Reason" htmlFor="waive-reason" required hint="Kept in the audit log." error={err?.field === 'reason' ? err.error : null}>
          <Textarea id="waive-reason" name="reason" maxLength={500} />
        </Field>
        <div className="flex gap-3">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton size="lg" className="flex-1" variant="danger" pendingLabel="Waiving…">
            Waive fee
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
