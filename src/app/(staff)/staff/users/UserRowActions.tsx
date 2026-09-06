'use client';

import { useActionState, useState } from 'react';
import { setUserActive, setUserRole } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Select, SubmitButton, Textarea } from '@/components/ui/form';
import { ROLE_LABELS, type Role } from '@/lib/rbac';
import type { ActionResult } from '@/lib/errors';

/**
 * Change a user's role, or deactivate them.
 *
 * Both require a reason and both are audited. The database also refuses to let
 * anyone change their own role or deactivate their own account, which is what
 * stops the last super admin locking the SACCO out of its own system.
 */
export function UserRowActions({
  userId,
  name,
  role,
  isActive,
}: {
  userId: string;
  name: string;
  role: Role;
  isActive: boolean;
}) {
  const [dialog, setDialog] = useState<null | 'role' | 'active'>(null);

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" icon="manage_accounts" onClick={() => setDialog('role')}>
          Role
        </Button>
        <Button
          variant={isActive ? 'outline' : 'primary'}
          size="sm"
          icon={isActive ? 'block' : 'check'}
          onClick={() => setDialog('active')}
        >
          {isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </div>

      <RoleDialog
        open={dialog === 'role'}
        onClose={() => setDialog(null)}
        userId={userId}
        name={name}
        role={role}
      />

      <ActiveDialog
        open={dialog === 'active'}
        onClose={() => setDialog(null)}
        userId={userId}
        name={name}
        isActive={isActive}
      />
    </>
  );
}

function RoleDialog({
  open,
  onClose,
  userId,
  name,
  role,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  role: Role;
}) {
  const [state, action] = useActionState<ActionResult<{ role: string }> | null, FormData>(
    setUserRole,
    null,
  );
  const err = state && !state.ok ? state : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change role"
      description={`${name} is currently a ${ROLE_LABELS[role]}.`}
    >
      {state?.ok ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">{state.message}</Alert>
          <Button size="lg" block onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="user_id" value={userId} />

          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          <Field label="New role" htmlFor="user-role" required>
            <Select id="user-role" name="role" defaultValue={role} required>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>

          <Alert tone="warning">
            Changing a role changes what this person can see and do immediately, including which
            members' financial records they can open.
          </Alert>

          <Field
            label="Reason"
            htmlFor="role-reason"
            required
            hint="Recorded permanently in the audit log."
            error={err?.field === 'reason' ? err.error : null}
          >
            <Textarea
              id="role-reason"
              name="reason"
              required
              maxLength={500}
              invalid={err?.field === 'reason'}
              placeholder="e.g. Promoted to branch manager as approved by the board on 12 August."
            />
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Saving…">
              Change role
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ActiveDialog({
  open,
  onClose,
  userId,
  name,
  isActive,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  isActive: boolean;
}) {
  const [state, action] = useActionState<ActionResult<{ is_active: boolean }> | null, FormData>(
    setUserActive,
    null,
  );
  const err = state && !state.ok ? state : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isActive ? 'Deactivate account' : 'Activate account'}
      description={
        isActive
          ? `${name} will be signed out and unable to sign in again.`
          : `${name} will be able to sign in again with their existing password.`
      }
    >
      {state?.ok ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">{state.message}</Alert>
          <Button size="lg" block onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-5" noValidate>
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="active" value={isActive ? 'false' : 'true'} />

          {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

          <Field
            label="Reason"
            htmlFor="active-reason"
            required
            hint="Recorded permanently in the audit log."
            error={err?.field === 'reason' ? err.error : null}
          >
            <Textarea
              id="active-reason"
              name="reason"
              required
              maxLength={500}
              invalid={err?.field === 'reason'}
              placeholder={
                isActive
                  ? 'e.g. Staff member has left the SACCO.'
                  : 'e.g. Returned from extended leave.'
              }
            />
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton
              size="lg"
              className="flex-1"
              variant={isActive ? 'danger' : 'primary'}
              pendingLabel="Saving…"
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
