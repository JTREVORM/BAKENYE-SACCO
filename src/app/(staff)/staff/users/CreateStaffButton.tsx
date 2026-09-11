'use client';

import { useActionState, useState } from 'react';
import { createStaffUser } from '@/app/actions/members';
import { Alert } from '@/components/ui/states';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input, PhoneInput, Select, SubmitButton } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';

type RoleOption = { key: string; name: string; description: string | null };

/**
 * Create a staff account.
 *
 * The temporary password is generated server-side and shown exactly once. It is
 * never emailed from here and never stored in readable form — the person
 * creating the account hands it over directly and the new user changes it on
 * first sign-in.
 */
export function CreateStaffButton({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  // Held in state so the hint under the picker describes the role actually
  // selected — roles are not self-explanatory from their names alone.
  const [role, setRole] = useState<string>(
    roles.find((r) => r.key === 'cashier')?.key ?? roles[0]?.key ?? '',
  );
  const [state, action] = useActionState<
    ActionResult<{ user_id: string; temp_password: string }> | null,
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

            <Alert tone="warning" title="Temporary password — shown only now">
              <p className="mt-1">
                Give this to them in person. They should change it the first time they sign in.
              </p>
              <p className="text-button-text font-button-text mt-2 select-all font-mono">
                {state.data.temp_password}
              </p>
            </Alert>

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
              label="Email address"
              htmlFor="staff-email"
              required
              hint="They sign in with this address."
              error={err?.field === 'email' ? err.error : null}
            >
              <Input
                id="staff-email"
                name="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                invalid={err?.field === 'email'}
              />
            </Field>

            <Field
              label="Phone number"
              htmlFor="staff-phone"
              error={err?.field === 'phone' ? err.error : null}
            >
              <PhoneInput id="staff-phone" name="phone" invalid={err?.field === 'phone'} />
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
              A temporary password will be generated and shown to you once. Nothing is emailed
              automatically.
            </Alert>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="lg" className="flex-1" pendingLabel="Creating…">
                Create account
              </SubmitButton>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
