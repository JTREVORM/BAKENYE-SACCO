'use client';

import { useActionState, useState } from 'react';
import { setMemberStatus } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Button, Field, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import { MEMBER_STATUS_HINTS, MEMBER_STATUS_LABELS, SELECTABLE_MEMBER_STATUSES } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import type { MemberStatus } from '@/types/db';

/**
 * Change a member's status.
 *
 * A reason is mandatory — the server rejects a blank one — because
 * deactivating a member is exactly the kind of administrative action the audit
 * log exists for. The database also refuses to deactivate anyone who still owes
 * money, so that failure surfaces here as a plain sentence rather than a
 * silent no-op.
 */
export function MemberStatusControl({
  memberId,
  status,
  name,
}: {
  memberId: string;
  status: MemberStatus;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult<{ status: string }> | null, FormData>(
    setMemberStatus,
    null,
  );
  const err = state && !state.ok ? state : null;
  const options = SELECTABLE_MEMBER_STATUSES.filter((s) => s !== status);
  const [choice, setChoice] = useState<MemberStatus>(options[0]);

  return (
    <>
      <Button variant="outline" icon="tune" onClick={() => setOpen(true)}>
        Status
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change member status"
        description={`${name} is currently ${MEMBER_STATUS_LABELS[status].toLowerCase()}.`}
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
            <input type="hidden" name="member_id" value={memberId} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field label="New status" htmlFor="status" required>
              <Select
                id="status"
                name="status"
                value={choice}
                onChange={(e) => setChoice(e.target.value as MemberStatus)}
                required
              >
                {options.map((s) => (
                  <option key={s} value={s}>
                    {MEMBER_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
              <p className="text-label-md text-on-surface-variant font-normal">{MEMBER_STATUS_HINTS[choice]}</p>
            </Field>

            <Field
              label="Reason"
              htmlFor="reason"
              required
              hint="Recorded permanently in the audit log."
              error={err?.field === 'reason' ? err.error : null}
            >
              <Textarea
                id="reason"
                name="reason"
                required
                maxLength={500}
                invalid={err?.field === 'reason'}
                placeholder="e.g. Member relocated and requested to exit the SACCO."
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
