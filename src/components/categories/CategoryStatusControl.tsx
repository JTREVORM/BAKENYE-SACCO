'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  setSavingsCategoryStatus,
  setShareCategoryStatus,
} from '@/app/actions/categories';
import { Icon } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, SubmitButton, Textarea } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';
import type { CategoryStatus } from '@/types/db';

/**
 * Retire a category, or bring it back.
 *
 * Retiring is the closest thing to deleting a category may have. Every member
 * who ever held it, and every schedule ever raised under it, references it — so
 * retiring removes it from the pickers and changes nothing already on the
 * books.
 *
 * A savings category that members are still saving under is refused outright by
 * the database, which counts them and says so. That is the right place for the
 * rule: retiring it silently would stop those members' schedules being raised,
 * and nobody would notice until they fell into arrears for a cycle the SACCO
 * never asked them about.
 */
export function CategoryStatusControl({
  kind,
  id,
  name,
  status,
  members,
}: {
  kind: 'share' | 'savings';
  id: string;
  name: string;
  status: CategoryStatus;
  members: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ status: CategoryStatus }> | null, FormData>(
    kind === 'share' ? setShareCategoryStatus : setSavingsCategoryStatus,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = state && !state.ok ? state : null;
  const retiring = status === 'active';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-surface text-label-md text-on-surface-variant hover:text-primary hover:shadow-card active:shadow-neu-pressed inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 font-semibold shadow-neu-sm transition-shadow"
      >
        <Icon name={retiring ? 'toggle_off' : 'toggle_on'} size={15} />
        {retiring ? 'Retire' : 'Restore'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={retiring ? `Retire ${name}?` : `Restore ${name}?`}
      >
        <form action={action} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={retiring ? 'inactive' : 'active'} />

          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          {retiring ? (
            <>
              <p className="text-body-lg text-on-surface">
                {name} will no longer be offered when a member&rsquo;s categories are set.
              </p>
              <Alert
                tone={members > 0 ? 'warning' : 'info'}
                title={
                  members > 0
                    ? `${members} active ${members === 1 ? 'member holds' : 'members hold'} this category`
                    : 'Nothing already recorded will change'
                }
              >
                {members > 0
                  ? kind === 'savings'
                    ? 'Move them to another savings category first — retiring this one would stop their schedules being raised, and they would simply stop being expected to save.'
                    : 'Their share history and progress stay exactly as they are; the category just stops being offered to new members.'
                  : 'History, schedules and payments keep referring to it. Only the pickers change.'}
              </Alert>
            </>
          ) : (
            <p className="text-body-lg text-on-surface">
              {name} will be offered again when a member&rsquo;s categories are set.
            </p>
          )}

          <Field
            label="Reason"
            htmlFor={`cat-status-reason-${id}`}
            required
            error={err?.field === 'reason' ? err.error : null}
            hint="Recorded in the audit log against your name."
          >
            <Textarea
              id={`cat-status-reason-${id}`}
              name="reason"
              required
              minLength={5}
              maxLength={500}
              rows={2}
              placeholder={
                retiring
                  ? 'Replaced by the new Platinum tier agreed at the September committee.'
                  : 'Brought back for the new intake.'
              }
              invalid={err?.field === 'reason'}
            />
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              variant={retiring ? 'danger' : 'primary'}
              size="lg"
              className="flex-1"
              pendingLabel="Saving…"
            >
              {retiring ? 'Retire' : 'Restore'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
