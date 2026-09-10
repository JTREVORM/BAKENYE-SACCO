'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { waiveSchedule } from '@/app/actions/collections';
import { Modal } from '@/components/ui/Modal';
import { Alert } from '@/components/ui/states';
import { Button, Field, SubmitButton, Textarea } from '@/components/ui/form';
import { formatUGX } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import type { SavingsScheduleRow, SavingsStatus } from '@/types/db';

/**
 * Forgive one scheduled contribution.
 *
 * A waiver writes off money the SACCO expected, so it is a management decision
 * with a mandatory reason. The schedule stays visible, marked "Waived", rather
 * than disappearing: the cycle still happened, and the record of the decision
 * belongs with it.
 */
export function WaiveScheduleDialog({
  row,
  memberId,
  open,
  onClose,
}: {
  row: SavingsScheduleRow | null;
  memberId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<{ status: SavingsStatus }> | null, FormData>(
    waiveSchedule,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // `onClose` is stable enough here: closing twice is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!row) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Waive this contribution?"
      description={`${row.member_name} · ${row.period_label}`}
    >
      <form action={formAction} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="schedule_id" value={row.schedule_id} />
        <input type="hidden" name="member_id" value={memberId} />

        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}

        <Alert tone="warning" title="This writes off an expected amount">
          {formatUGX(row.expected_amount)} will no longer be counted as owed by{' '}
          {row.member_name} for {row.period_label}. The schedule stays visible, marked as waived.
        </Alert>

        <Field
          label="Reason"
          htmlFor="waive-reason"
          required
          hint="Recorded in the audit log against your name."
        >
          <Textarea
            id="waive-reason"
            name="reason"
            required
            minLength={5}
            maxLength={500}
            placeholder="Bereavement in the family; agreed by the committee."
          />
        </Field>

        <div className="flex gap-3">
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton
            variant="danger"
            size="lg"
            className="flex-1"
            pendingLabel="Waiving…"
            icon="block"
          >
            Waive
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
