'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '../actions';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import type { ActionResult } from '@/lib/errors';

export function ForgotPasswordForm() {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    requestPasswordReset,
    null,
  );

  if (state?.ok) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Alert tone="success" title="What happens next">
          {state.message}
        </Alert>
        <Link
          href="/login"
          className="bg-ink text-white h-touch-target-primary text-button-text mt-2 flex items-center justify-center rounded-full font-semibold shadow-neu-dark"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  const error = state && !state.ok ? state : null;

  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <Field
        label="Member Number or Phone Number"
        htmlFor="identifier"
        emphasis
        required
        error={error?.error ?? null}
        hint="Staff may also use the email address on their account."
      >
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="send"
          required
          invalid={!!error}
          placeholder="Member Number or Phone Number"
        />
      </Field>

      <SubmitButton size="lg" block pendingLabel="Sending...">
        Continue
      </SubmitButton>
    </form>
  );
}
