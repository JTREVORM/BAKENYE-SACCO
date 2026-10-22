'use client';

import { useActionState } from 'react';
import { withPasswordFeedback } from '@/components/auth/password-feedback';
import { changePassword } from '@/app/(auth)/actions';
import { Alert } from '@/components/ui/states';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import type { ActionResult } from '@/lib/errors';

/**
 * Change your own password while signed in - members and staff alike.
 *
 * This changes the password and nothing else. A member's name, phone and member
 * number are the SACCO's official record and are changed only by staff; the
 * password is the member's own.
 *
 * Requires the current password, so an unattended unlocked phone cannot be used
 * to take over the account.
 */
const passwordAction = withPasswordFeedback(changePassword);

export function ChangePasswordForm() {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    passwordAction,
    null,
  );
  const err = state && !state.ok ? state : null;

  return (
    <section className="bg-surface-container-lowest border-surface-container-high shadow-card overflow-hidden rounded-xl border">
      <div className="border-surface-container-high bg-surface-container-low/50 border-b px-4 py-3">
        <h2 className="text-button-text font-button-text text-on-surface">Change password</h2>
      </div>

      <form action={action} className="flex flex-col gap-5 p-4" noValidate>
        {state?.ok ? <Alert tone="success">{state.message}</Alert> : null}
        {err && !err.field ? <Alert tone="error">{err.error}</Alert> : null}

        <Field
          label="Current password"
          htmlFor="current_password"
          required
          error={err?.field === 'current_password' ? err.error : null}
        >
          <Input
            id="current_password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            invalid={err?.field === 'current_password'}
          />
        </Field>

        <Field
          label="New password"
          htmlFor="new_password"
          required
          hint="At least 8 characters, including a letter and a number."
          error={err?.field === 'password' ? err.error : null}
        >
          <Input
            id="new_password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            invalid={err?.field === 'password'}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="confirm_password"
          required
          error={err?.field === 'confirm' ? err.error : null}
        >
          <Input
            id="confirm_password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            enterKeyHint="done"
            required
            invalid={err?.field === 'confirm'}
          />
        </Field>

        <SubmitButton size="lg" block pendingLabel="Saving…">
          Change password
        </SubmitButton>
      </form>
    </section>
  );
}
