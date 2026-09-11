'use client';

import { useActionState, useState } from 'react';
import { createStaffUser } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, PhoneInput, Select, SubmitButton } from '@/components/ui/form';
import { TemporaryPasswordCard } from '@/components/accounts/TemporaryPassword';
import type { ActionResult } from '@/lib/errors';
import type { TemporaryPassword } from '@/types/access';

type RoleOption = { key: string; name: string; description: string | null };

/**
 * Create a staff account.
 *
 * A colleague signs in with their phone number or, if they have one, their
 * email - one of the two is needed. The account is ready at once, on a
 * generated temporary password shown here once; they must change it the first
 * time they sign in.
 */
export function CreateStaffButton({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  // Held in state so the hint under the picker describes the role actually
  // selected — roles are not self-explanatory from their names alone.
  const [role, setRole] = useState<string>(
    roles.find((r) => r.key === 'cashier')?.key ?? roles[0]?.key ?? '',
  );
  const [state, action] = useActionState<
    ActionResult<{ user_id: string; temporary: TemporaryPassword }> | null,
    FormData
  >(createStaffUser, null);

  const err = state && !state.ok ? state : null;

  return (
    <>
      <Button icon="person_add" onClick={() => setOpen(true)}>
        <span className="hidden sm:inline">Add staff account</span>
        <span className="sm:hidden">Add</span>
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a staff account"
        description="Give a colleague access to the SACCO system."
      >
        {state?.ok ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success" title="Account created">
              {state.message}
            </Alert>

            <TemporaryPasswordCard temporary={state.data.temporary} who="them" />

            <Button size="lg" block onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-5" noValidate>
            {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

            <Field
              label="Full name"
              htmlFor="staff-name"
              required
              error={err?.field === 'full_name' ? err.error : null}
            >
              <Input
                id="staff-name"
                name="full_name"
                autoCapitalize="words"
                required
                invalid={err?.field === 'full_name'}
              />
            </Field>

            <Field
              label="Phone number"
              htmlFor="staff-phone"
              hint="They can sign in with this number."
              error={err?.field === 'phone' ? err.error : null}
            >
              <PhoneInput id="staff-phone" name="phone" invalid={err?.field === 'phone'} />
            </Field>

            <Field
              label="Email address (optional)"
              htmlFor="staff-email"
              hint="Only if they use email. Either the phone or the email is needed to sign in."
              error={err?.field === 'email' ? err.error : null}
            >
              <Input
                id="staff-email"
                name="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                invalid={err?.field === 'email'}
              />
            </Field>

            <Field
              label="Role"
              htmlFor="staff-role"
              required
              hint={roles.find((r) => r.key === role)?.description ?? undefined}
              error={err?.field === 'role' ? err.error : null}
            >
              <Select
                id="staff-role"
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                required
              >
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Alert tone="info">
              A temporary password is generated and shown to you once. They must change it the first
              time they sign in.
            </Alert>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Creating...">
                Create account
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
