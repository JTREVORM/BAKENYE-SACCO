'use client';

import { useActionState, useState } from 'react';
import { setGroupStatus } from '@/app/actions/groups';
import { Alert } from '@/components/ui/states';
import { Button, Field, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import { GROUP_STATUS_LABELS } from '@/lib/groups';
import type { ActionResult } from '@/lib/errors';
import type { GroupStatus } from '@/types/db';

/**
 * Change the status of a group.
 *
 * A reason is mandatory. Dissolving is refused by the database while active
 * members are still attached — their savings history has to move somewhere
 * first — and that refusal surfaces here as a sentence, not a silent no-op.
 */
export function GroupStatusControl({
  groupId,
  status,
  name,
}: {
  groupId: string;
  status: GroupStatus;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ status: GroupStatus }> | null, FormData>(
    setGroupStatus,
    null,
  );
  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant="outline" icon="tune" onClick={() => setOpen(true)}>
        Status
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change group status"
        description={`${name} is currently ${GROUP_STATUS_LABELS[status].toLowerCase()}.`}
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{state.message}</Alert>
            <Button size="lg" block onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="group_id" value={groupId} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field label="New status" htmlFor="group-status" required>
              <Select id="group-status" name="status" defaultValue={status} required>
                {(Object.keys(GROUP_STATUS_LABELS) as GroupStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {GROUP_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>

            <Alert tone="warning">
              An inactive group keeps its history but stops appearing on collection days.
            </Alert>

            <Field
              label="Reason"
              htmlFor="group-status-reason"
              required
              hint="Recorded permanently in the audit log."
              error={err?.field === 'reason' ? err.error : null}
            >
              <Textarea
                id="group-status-reason"
                name="reason"
                required
                maxLength={500}
                invalid={err?.field === 'reason'}
                placeholder="e.g. The group has merged with Buwenge Traders."
              />
            </Field>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
                Update status
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
