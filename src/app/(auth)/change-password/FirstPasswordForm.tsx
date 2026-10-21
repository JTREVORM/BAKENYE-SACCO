'use client';

import { chooseFirstPassword } from '../actions';
import { SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { ActionForm } from '@/components/forms/ActionForm';
import { useSubmission } from '@/components/forms/useSubmission';
import { UnresolvedNotice } from '@/components/forms/UnresolvedSubmission';
import { PasswordField } from '../login/LoginForm';

export function FirstPasswordForm({ minLength }: { minLength: number }) {
  const submission = useSubmission<null>(chooseFirstPassword);
  const state = submission.result;
  const error = state && !state.ok ? state : null;
  const at = (f: string) => (error?.field === f ? error.error : null);

  return (
    <ActionForm submission={submission} className="mt-6 flex flex-col gap-4 sm:gap-5" noValidate>
      {error && !error.field ? <Alert tone="error">{error.error}</Alert> : null}
      {submission.unresolved ? <UnresolvedNotice noun="password change" /> : null}

      <PasswordField
        id="current_password"
        name="current_password"
        label="Temporary password"
        autoComplete="current-password"
        placeholder="From the SACCO"
        error={at('current_password')}
      />

      <PasswordField
        id="password"
        name="password"
        label="New password"
        autoComplete="new-password"
        placeholder="Choose a password"
        error={at('password')}
        hint={`At least ${minLength} characters, with a letter and a number.`}
      />

      <PasswordField
        id="confirm"
        name="confirm"
        label="Confirm new password"
        autoComplete="new-password"
        placeholder="Type it again"
        error={at('confirm')}
      />

      <SubmitButton size="lg" block className="mt-1" pendingLabel="Saving...">
        Save password and continue
      </SubmitButton>
    </ActionForm>
  );
}
