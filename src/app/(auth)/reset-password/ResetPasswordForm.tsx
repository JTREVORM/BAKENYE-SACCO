'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resetPassword } from '../actions';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import type { ActionResult } from '@/lib/errors';

/** Live rules, so the member is not told what is wrong only after submitting. */
function rules(password: string) {
  return [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Contains a letter', met: /[a-zA-Z]/.test(password) },
    { label: 'Contains a number', met: /[0-9]/.test(password) },
  ];
}

export function ResetPasswordForm() {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(resetPassword, null);
  const [password, setPassword] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(() => router.push('/login?reset=done'), 1500);
      return () => clearTimeout(t);
    }
  }, [state, router]);

  const error = state && !state.ok ? state : null;

  if (state?.ok) {
    return (
      <div className="mt-6">
        <Alert tone="success" title="Password changed">
          Taking you to sign in…
        </Alert>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      {error && !error.field ? <Alert tone="error">{error.error}</Alert> : null}

      <Field
        label="New password"
        htmlFor="password"
        required
        error={error?.field === 'password' ? error.error : null}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          invalid={error?.field === 'password'}
        />
      </Field>

      <ul className="flex flex-col gap-1">
        {rules(password).map((r) => (
          <li
            key={r.label}
            className={`text-label-md font-label-md flex items-center gap-1.5 normal-case ${
              r.met ? 'text-tertiary' : 'text-on-surface-variant'
            }`}
          >
            <Icon name={r.met ? 'check_circle' : 'radio_button_unchecked'} size={16} />
            {r.label}
          </li>
        ))}
      </ul>

      <Field
        label="Confirm new password"
        htmlFor="confirm"
        required
        error={error?.field === 'confirm' ? error.error : null}
      >
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          enterKeyHint="done"
          required
          invalid={error?.field === 'confirm'}
        />
      </Field>

      <SubmitButton size="lg" block pendingLabel="Saving…" className="mt-2">
        Save new password
      </SubmitButton>
    </form>
  );
}
