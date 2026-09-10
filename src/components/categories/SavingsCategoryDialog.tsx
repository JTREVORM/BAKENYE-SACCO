'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSavingsCategory } from '@/app/actions/categories';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import {
  Button,
  Field,
  Input,
  MoneyInput,
  RadioCard,
  SubmitButton,
  Textarea,
} from '@/components/ui/form';
import { SAVINGS_FREQUENCY_ADVERB } from '@/lib/categories';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { SavingsCategoryRow, SavingsFrequency } from '@/types/db';

/**
 * Create or edit a savings category.
 *
 * Amount and frequency together are the whole expectation: UGX 5,000 weekly and
 * UGX 100,000 monthly are the same two fields with different values, which is
 * why the SACCO can add a fourth tier without a developer.
 *
 * Editing an existing category is explicitly forward-looking. The confirmation
 * says so, because a manager correcting a typo needs to know it will not
 * retroactively put anyone into arrears.
 */
export function SavingsCategoryDialog({
  category,
  trigger = 'button',
}: {
  category?: SavingsCategoryRow;
  trigger?: 'button' | 'link';
}) {
  const router = useRouter();
  const editing = !!category;
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ id: string; name: string }> | null, FormData>(
    saveSavingsCategory,
    null,
  );

  const [amount, setAmount] = useState<number | null>(Number(category?.amount ?? 0) || null);
  const [frequency, setFrequency] = useState<SavingsFrequency>(category?.frequency ?? 'monthly');

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = state && !state.ok ? state : null;

  return (
    <>
      {trigger === 'link' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-surface text-label-md text-on-surface-variant hover:text-primary hover:shadow-card active:shadow-neu-pressed inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-semibold shadow-neu-sm transition-shadow"
        >
          <Icon name="edit" size={15} />
          Edit
        </button>
      ) : (
        <Button icon="add" onClick={() => setOpen(true)}>
          Add savings category
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${category.name}` : 'New savings category'}
        description="What members in this category save, and how often."
      >
        <form action={action} className="flex flex-col gap-5" noValidate>
          {editing ? <input type="hidden" name="id" value={category.id} /> : null}
          <input type="hidden" name="frequency" value={frequency} />

          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          <Field
            label="Name"
            htmlFor="savings-cat-name"
            required
            error={err?.field === 'name' ? err.error : null}
          >
            <Input
              id="savings-cat-name"
              name="name"
              required
              maxLength={60}
              defaultValue={category?.name}
              placeholder="e.g. Platinum Saver"
              invalid={err?.field === 'name'}
            />
          </Field>

          <Field
            label="Amount saved each cycle"
            htmlFor="savings-cat-amount"
            required
            error={err?.field === 'amount' ? err.error : null}
          >
            <MoneyInput
              id="savings-cat-amount"
              name="amount"
              value={amount ?? ''}
              onValueChange={setAmount}
              required
            />
          </Field>

          <fieldset>
            <legend className="text-label-md font-label-md text-on-surface-variant mb-2">
              How often
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RadioCard
                name="frequency_choice"
                value="weekly"
                checked={frequency === 'weekly'}
                onChange={() => setFrequency('weekly')}
                title="Weekly"
                description="Due at the end of each Monday-to-Sunday week."
                icon="calendar_today"
              />
              <RadioCard
                name="frequency_choice"
                value="monthly"
                checked={frequency === 'monthly'}
                onChange={() => setFrequency('monthly')}
                title="Monthly"
                description="Due on the last day of each calendar month."
                icon="calendar_month"
              />
            </div>
          </fieldset>

          {amount ? (
            <div className="bg-surface-container-low flex items-baseline justify-between gap-3 rounded-xl p-4 shadow-neu-sm">
              <span className="text-label-md font-label-md text-on-surface-variant normal-case">
                Members in this category will save
              </span>
              <span className="text-button-text font-button-text text-on-surface tabular font-bold">
                {formatUGX(amount)} {SAVINGS_FREQUENCY_ADVERB[frequency]}
              </span>
            </div>
          ) : null}

          <Field label="Description" htmlFor="savings-cat-desc">
            <Textarea
              id="savings-cat-desc"
              name="description"
              maxLength={300}
              rows={2}
              defaultValue={category?.description ?? ''}
            />
          </Field>

          {editing ? (
            <Alert tone="warning" title="This applies from now on">
              Schedules already raised keep the amount they were judged against, and payments
              already banked are untouched. Only future cycles — and unpaid ones not yet due — use
              the new figure.
            </Alert>
          ) : null}

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
              {editing ? 'Save changes' : 'Add category'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
