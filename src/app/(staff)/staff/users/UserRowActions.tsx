'use client';

import { useActionState, useState } from 'react';
import { issueResetCode, setUserActive, setUserPhone, setUserRole } from '@/app/actions/members';
import { IssueCodeButton } from '@/components/accounts/SetupCode';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, PhoneInput, Select, SubmitButton, Textarea } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';

type RoleOption = { key: string; name: string; description: string | null };

/**
 * Change a user's role or sign-in phone, reset their password, or deactivate
 * them. A reset issues a one-time code - nobody ever sees a password.
 *
 * Both require a reason and both are audited. The database also refuses to let
 * anyone change their own role or deactivate their own account, which is what
 * stops the last super admin locking the SACCO out of its own system.
 */
export function UserRowActions({
  userId,
  name,
  role,
  roleName,
  roles,
  isActive,
  phone,
}: {
  phone: string | null;
  userId: string;
  name: string;
  role: string;
  roleName: string;
  /** The roles the signed-in person may assign. */
  roles: RoleOption[];
  isActive: boolean;
}) {
  const [dialog, setDialog] = useState<null | 'role' | 'active' | 'phone'>(null);

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" icon="manage_accounts" onClick={() => setDialog('role')}>
          Role
        </Button>
        <Button variant="outline" size="sm" icon="phone" onClick={() => setDialog('phone')}>
          Phone
        </Button>
        <IssueCodeButton
          action={issueResetCode}
          fields={{ user_id: userId, purpose: 'reset' }}
          label="Reset password"
          title="Reset password"
          description={`Issue ${name} a one-time code to choose a new password with.`}
          confirmLabel="Issue reset code"
          who={name}
          size="sm"
        />
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
        roleName={roleName}
        roles={roles}
      />

      <PhoneDialog
        open={dialog === 'phone'}
        onClose={() => setDialog(null)}
        userId={userId}
        name={name}
        phone={phone}
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
  roleName,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  role: string;
  roleName: string;
  roles: RoleOption[];
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
      description={`${name} currently has the ${roleName} role.`}
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
              {roles.some((r) => r.key === role) ? null : (
                <option value={role} disabled>
                  {roleName}
                </option>
              )}
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
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

function PhoneDialog({
  open,
  onClose,
  userId,
  name,
  phone,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  phone: string | null;
}) {
  const [state, action] = useActionState<ActionResult<{ phone: string | null }> | null, FormData>(
    setUserPhone,
    null,
  );
  const err = state && !state.ok ? state : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sign-in phone number"
      description={`${name} can sign in with this number and their password. Leave it blank to sign in by email only.`}
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
          <Field label="Phone number" htmlFor="user-phone" error={err?.field === 'phone' ? err.error : null}>
            <PhoneInput id="user-phone" name="phone" defaultValue={phone ?? ''} invalid={err?.field === 'phone'} />
          </Field>
          <Field
            label="Reason"
            htmlFor="phone-reason"
            required
            hint="Recorded permanently in the audit log."
            error={err?.field === 'reason' ? err.error : null}
          >
            <Textarea id="phone-reason" name="reason" required maxLength={500} invalid={err?.field === 'reason'} />
          </Field>
          <div className="flex gap-3">
            <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="lg" className="flex-1" pendingLabel="Saving...">
              Save
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
