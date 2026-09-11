'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveFee, setFeeStatus } from '@/app/actions/fees';
import { Modal } from '@/components/ui/Modal';
import { Alert, EmptyState } from '@/components/ui/states';
import { Badge, Icon } from '@/components/ui/primitives';
import {
  Button,
  Field,
  Input,
  MoneyInput,
  Select,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { formatDate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { ActionResult } from '@/lib/errors';
import type { FeeChargedWhen, FeeRow, FeeType } from '@/types/access';

export const FEE_TYPE_LABELS: Record<FeeType, string> = {
  membership: 'Membership',
  registration: 'Registration',
  application: 'Application',
  passbook: 'Passbook',
  welfare: 'Welfare',
  subscription: 'Subscription',
  other: 'Other',
};

export const FEE_WHEN_LABELS: Record<FeeChargedWhen, string> = {
  registration: 'At registration',
  annual: 'Annually',
  on_request: 'When requested',
};

const FEE_WHEN_HINTS: Record<FeeChargedWhen, string> = {
  registration: 'Charged automatically to every new member when they are registered.',
  annual:
    'Charged by staff from each member’s record once a year. Nothing charges it automatically.',
  on_request:
    'Charged by staff from a member’s record when it applies - a replacement passbook, for example.',
};

type IncomeCategory = { id: string; name: string; is_active?: boolean };

/**
 * Settings -> Fees.
 *
 * Every fee the SACCO charges is a row here, set by a manager. Registration
 * reads the active ones; nothing anywhere in the application holds an amount
 * of its own. A fee is never deleted - past receipts name it - so a fee that
 * is no longer charged is made inactive.
 */
export function FeeManager({
  fees,
  incomeCategories,
  canManage,
}: {
  fees: FeeRow[];
  incomeCategories: IncomeCategory[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<FeeRow | 'new' | null>(null);
  const [toggling, setToggling] = useState<FeeRow | null>(null);

  const active = fees.filter((f) => f.status === 'active');
  const inactive = fees.filter((f) => f.status !== 'active');
  const registrationTotal = active
    .filter((f) => f.charged_when === 'registration' && f.applies_to_new_members && f.is_mandatory)
    .reduce((sum, f) => sum + Number(f.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title-md text-on-surface">Registration &amp; membership fees</h3>
          <p className="text-body-md text-on-surface-variant mt-0.5 max-w-2xl">
            {active.length === 0
              ? 'No fees are set up, so registering a member charges nothing.'
              : `${active.length} active ${active.length === 1 ? 'fee' : 'fees'}. A new member is charged ${formatUGX(registrationTotal)} in mandatory registration fees, plus any optional fee they take.`}
          </p>
        </div>
        {canManage ? (
          <Button icon="add" onClick={() => setEditing('new')}>
            Create Fee
          </Button>
        ) : null}
      </div>

      {fees.length === 0 ? (
        <div className="bg-surface-container rounded-3xl shadow-neu-inset-sm">
          <EmptyState
            icon="receipt"
            title="No fees yet"
            description="Create the fees the SACCO charges - a membership fee, a registration fee, a passbook fee - and registration will total them for you. Only the fees you create exist."
            action={
              canManage ? (
                <Button icon="add" onClick={() => setEditing('new')}>
                  Create the first fee
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {active.map((f) => (
              <FeeCard
                key={f.id}
                fee={f}
                canManage={canManage}
                onEdit={() => setEditing(f)}
                onToggle={() => setToggling(f)}
              />
            ))}
          </ul>

          {inactive.length > 0 ? (
            <div>
              <h4 className="text-label-md text-on-surface-variant mb-2 font-semibold uppercase tracking-wide">
                Inactive - kept for the record
              </h4>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {inactive.map((f) => (
                  <FeeCard
                    key={f.id}
                    fee={f}
                    canManage={canManage}
                    onEdit={() => setEditing(f)}
                    onToggle={() => setToggling(f)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <Alert tone="info" title="Changing a fee never changes what was paid">
        Each member’s charge keeps the amount it was made at. Raising the Membership Fee changes what
        the next member is charged; every receipt already issued stays exactly as it was.
      </Alert>

      {editing ? (
        <FeeDialog
          fee={editing === 'new' ? null : editing}
          incomeCategories={incomeCategories}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {toggling ? <StatusDialog fee={toggling} onClose={() => setToggling(null)} /> : null}
    </div>
  );
}

function FeeCard({
  fee,
  canManage,
  onEdit,
  onToggle,
}: {
  fee: FeeRow;
  canManage: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const active = fee.status === 'active';
  const upcoming = fee.effective_from > new Date().toISOString().slice(0, 10);

  return (
    <li
      className={clsx(
        'flex flex-col gap-3 rounded-3xl bg-surface p-4 shadow-neu',
        !active && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-lg text-on-surface truncate font-semibold">{fee.name}</p>
          <p className="text-title-md text-primary tabular mt-0.5 font-bold">{formatUGX(fee.amount)}</p>
        </div>
        <span className="bg-surface-container text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-neu-inset-sm">
          <Icon name="receipt" size={20} />
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={fee.is_mandatory ? 'warning' : 'neutral'}>
          {fee.is_mandatory ? 'Mandatory' : 'Optional'}
        </Badge>
        <Badge tone={active ? 'success' : 'neutral'} dot>
          {active ? 'Active' : 'Inactive'}
        </Badge>
        <Badge tone="info">{FEE_WHEN_LABELS[fee.charged_when]}</Badge>
        {upcoming ? <Badge tone="accent">From {formatDate(fee.effective_from)}</Badge> : null}
      </div>

      <p className="text-label-md text-on-surface-variant font-normal">
        {FEE_TYPE_LABELS[fee.fee_type]} fee ·{' '}
        {fee.applies_to_new_members && fee.applies_to_existing_members
          ? 'new and existing members'
          : fee.applies_to_new_members
            ? 'new members'
            : 'existing members'}
        {fee.description ? ` · ${fee.description}` : ''}
      </p>

      {canManage ? (
        <div className="mt-auto flex gap-2 border-t border-outline-variant/70 pt-3">
          <Button variant="outline" size="sm" icon="edit" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" icon={active ? 'block' : 'check'} onClick={onToggle}>
            {active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function Check({
  name,
  label,
  hint,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="bg-surface-container flex cursor-pointer items-start gap-3 rounded-2xl p-3.5 shadow-neu-inset-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="text-primary focus:ring-primary border-outline mt-0.5 h-5 w-5 shrink-0 rounded"
      />
      <span className="min-w-0">
        <span className="text-body-md text-on-surface block font-semibold">{label}</span>
        {hint ? <span className="text-label-md text-on-surface-variant mt-0.5 block font-normal">{hint}</span> : null}
      </span>
    </label>
  );
}

function FeeDialog({
  fee,
  incomeCategories,
  onClose,
}: {
  fee: FeeRow | null;
  incomeCategories: IncomeCategory[];
  onClose: () => void;
}) {
  const [state, action] = useActionState<ActionResult<FeeRow> | null, FormData>(saveFee, null);
  const [when, setWhen] = useState<FeeChargedWhen>(fee?.charged_when ?? 'registration');
  const [amount, setAmount] = useState<number | null>(fee ? Number(fee.amount) : null);
  const err = state && !state.ok ? state : null;
  const amountChanged = !!fee && amount !== null && amount !== Number(fee.amount);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={fee ? `Edit ${fee.name}` : 'Create a fee'}
      description={
        fee
          ? 'Changes apply to charges made from now on. Charges already made keep their amount.'
          : 'The fee is charged only in the way you set here.'
      }
      size="lg"
    >
      <form action={action} className="flex flex-col gap-5" noValidate>
        {fee ? <input type="hidden" name="fee_id" value={fee.id} /> : null}
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

        <Field label="Fee name" htmlFor="fee-name" required error={err?.field === 'name' ? err.error : null}>
          <Input id="fee-name" name="name" defaultValue={fee?.name} maxLength={80} placeholder="e.g. Membership Fee" required />
        </Field>

        <Field
          label="Amount"
          htmlFor="fee-amount"
          required
          error={err?.field === 'amount' ? err.error : null}
        >
          <MoneyInput
            id="fee-amount"
            name="amount"
            defaultValue={fee ? Number(fee.amount) : undefined}
            onValueChange={setAmount}
            invalid={err?.field === 'amount'}
          />
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Kind of fee" htmlFor="fee-type" required>
            <Select id="fee-type" name="fee_type" defaultValue={fee?.fee_type ?? 'membership'}>
              {(Object.keys(FEE_TYPE_LABELS) as FeeType[]).map((t) => (
                <option key={t} value={t}>
                  {FEE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When it applies" htmlFor="fee-when" required hint={FEE_WHEN_HINTS[when]}>
            <Select
              id="fee-when"
              name="charged_when"
              value={when}
              onChange={(e) => setWhen(e.target.value as FeeChargedWhen)}
            >
              {(Object.keys(FEE_WHEN_LABELS) as FeeChargedWhen[]).map((w) => (
                <option key={w} value={w}>
                  {FEE_WHEN_LABELS[w]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <Check
            name="is_mandatory"
            label="Mandatory"
            hint="A mandatory registration fee must be paid (or waived) before a new member becomes active, if Settings → Members says so."
            defaultChecked={fee?.is_mandatory ?? true}
          />
          <Check
            name="applies_to_new_members"
            label="Applies to new members"
            defaultChecked={fee?.applies_to_new_members ?? true}
          />
          <Check
            name="applies_to_existing_members"
            label="Applies to existing members"
            hint="Staff can charge it to a member from their record."
            defaultChecked={fee?.applies_to_existing_members ?? false}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Effective from"
            htmlFor="fee-effective"
            hint="Registrations before this date are not charged it."
          >
            <Input id="fee-effective" name="effective_from" type="date" defaultValue={fee?.effective_from ?? ''} />
          </Field>
          <Field
            label="Booked as income under"
            htmlFor="fee-income"
            error={err?.field === 'income_category_id' ? err.error : null}
          >
            <Select id="fee-income" name="income_category_id" defaultValue={fee?.income_category_id ?? ''}>
              <option value="">A category named after this fee</option>
              {incomeCategories
                .filter((c) => c.is_active !== false)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <Field label="Description" htmlFor="fee-desc" hint="Optional. Shown to staff when they register a member.">
          <Textarea id="fee-desc" name="description" maxLength={300} defaultValue={fee?.description ?? ''} />
        </Field>

        {fee ? (
          <Field
            label="Reason for the change"
            htmlFor="fee-reason"
            required={amountChanged}
            hint={amountChanged ? 'Required when the amount changes. Kept in the audit log.' : 'Kept in the audit log.'}
            error={err?.field === 'reason' ? err.error : null}
          >
            <Textarea
              id="fee-reason"
              name="reason"
              maxLength={500}
              placeholder="e.g. Membership fee raised by the AGM of 30 August."
            />
          </Field>
        ) : null}

        <div className="flex gap-3">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
            {fee ? 'Save fee' : 'Create fee'}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function StatusDialog({ fee, onClose }: { fee: FeeRow; onClose: () => void }) {
  const [state, action] = useActionState<ActionResult<FeeRow> | null, FormData>(setFeeStatus, null);
  const err = state && !state.ok ? state : null;
  const deactivating = fee.status === 'active';

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={deactivating ? `Deactivate ${fee.name}` : `Activate ${fee.name}`}
      description={
        deactivating
          ? 'New members will no longer be charged it. It is kept, with every charge and receipt that names it; nothing is deleted.'
          : `New charges will be made at ${formatUGX(fee.amount)}.`
      }
    >
      <form action={action} className="flex flex-col gap-5" noValidate>
        <input type="hidden" name="fee_id" value={fee.id} />
        <input type="hidden" name="status" value={deactivating ? 'inactive' : 'active'} />
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}
        <Field
          label="Reason"
          htmlFor="fee-status-reason"
          required
          hint="Recorded permanently in the audit log."
          error={err?.field === 'reason' ? err.error : null}
        >
          <Textarea id="fee-status-reason" name="reason" required maxLength={500} />
        </Field>
        <div className="flex gap-3">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton size="lg" className="flex-1" variant={deactivating ? 'danger' : 'primary'} pendingLabel="Saving…">
            {deactivating ? 'Deactivate' : 'Activate'}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
