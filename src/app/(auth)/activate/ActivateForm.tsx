'use client';

import { useActionState } from 'react';
import { activateAccount } from '../actions';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { IconWell, PasswordField } from '../login/LoginForm';
import type { ActionResult } from '@/lib/errors';

export function ActivateForm({ minLength }: { minLength: number }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(activateAccount, null);
  const error = state && !state.ok ? state : null;
  const at = (f: string) => (error?.field === f ? error.error : null);

  return (
    <form action={action} className="mt-6 flex flex-col gap-4 sm:gap-5" noValidate>
      {error && !error.field ? (
        <Alert tone="error">{error.error}</Alert>
      ) : null}

      <Field
        label="Member Number or Phone Number"
        htmlFor="identifier"
        emphasis
        required
        error={at('identifier')}
      >
        <IconWell icon="person">
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            required
            invalid={!!at('identifier')}
            placeholder="Member Number or Phone Number"
            className="pl-14"
          />
        </IconWell>
      </Field>

      <Field
        label="Setup code"
        htmlFor="code"
        emphasis
        required
        error={at('code')}
        hint="Ten letters and numbers, e.g. K7QMP-4X2RA."
      >
        <IconWell icon="key">
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            required
            invalid={!!at('code')}
            placeholder="XXXXX-XXXXX"
            className="tabular pl-14 font-mono uppercase tracking-wider"
          />
        </IconWell>
      </Field>

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
        label="Confirm password"
        autoComplete="new-password"
        placeholder="Type it again"
        error={at('confirm')}
      />

      <SubmitButton size="lg" block className="mt-1" pendingLabel="Setting up...">
        Set password and sign in
      </SubmitButton>
    </form>
  );
}
