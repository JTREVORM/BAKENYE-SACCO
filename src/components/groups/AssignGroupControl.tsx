'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { assignMemberGroup } from '@/app/actions/groups';
import { Alert } from '@/components/ui/states';
import { Button, Field, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/Modal';
import { savingDayLabel } from '@/lib/groups';
import type { ActionResult } from '@/lib/errors';
import type { SaccoGroupRow } from '@/types/db';

/**
 * Move a member into a group, or out of one.
 *
 * Only schedules that are still pending and unpaid follow the member. Anything
 * already collected stays with the group that collected it — otherwise last
 * month's collection sheet would quietly rewrite itself, and the two would
 * stop reconciling.
 */
export function AssignGroupControl({
  memberId,
  memberName,
  currentGroupId,
  groups,
}: {
  memberId: string;
  memberName: string;
  currentGroupId: string | null;
  groups: SaccoGroupRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<
    ActionResult<{ group_name: string | null; schedules_moved: number }> | null,
    FormData
  >(assignMemberGroup, null);
  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button variant="outline" icon="groups" onClick={() => setOpen(true)}>
        {currentGroupId ? 'Change group' : 'Assign group'}
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          if (state?.ok) router.refresh();
        }}
        title={currentGroupId ? 'Change group' : 'Assign to a group'}
        description={`${memberName} saves with the group they belong to, on that group's day.`}
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">
              {state.message}
              {state.data.schedules_moved > 0
                ? ` ${state.data.schedules_moved} upcoming ${state.data.schedules_moved === 1 ? 'schedule' : 'schedules'} moved across; settled history stayed with the old group.`
                : ''}
            </Alert>
            <Button
              size="lg"
              block
              onClick={() => {
                setOpen(false);
                router.refresh();
              }}
            >
              Close
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="member_id" value={memberId} />

            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field
              label="Group"
              htmlFor="assign-group"
              error={err?.field === 'group_id' ? err.error : null}
              hint="Members without a group do not appear on any collection sheet."
            >
              <Select id="assign-group" name="group_id" defaultValue={currentGroupId ?? ''}>
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {savingDayLabel(g.saving_day)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Reason" htmlFor="assign-reason" hint="Optional, but kept in the audit log.">
              <Textarea
                id="assign-reason"
                name="reason"
                maxLength={500}
                rows={2}
                placeholder="e.g. Moved to Buwenge and now attends the Monday meeting."
              />
            </Field>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
