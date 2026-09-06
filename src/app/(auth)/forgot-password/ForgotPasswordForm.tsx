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
        <Alert tone="success" title="Check your email">
          {state.message}
        </Alert>
        <p className="text-body-md font-body-md text-on-surface-variant">
          The link is valid for one hour. If it does not arrive, check your spam folder.
        </p>
        <Link
          href="/login"
          className="bg-primary text-on-primary h-touch-target-primary text-button-text font-button-text mt-2 flex items-center justify-center rounded-lg font-semibold"
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
        label="Email address"
        htmlFor="email"
        required
        error={error?.error ?? null}
      >
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          required
          invalid={!!error}
          placeholder="you@example.com"
        />
      </Field>

      <SubmitButton size="lg" block pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
