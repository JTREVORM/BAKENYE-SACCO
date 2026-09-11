'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { signIn } from '../actions';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import type { IconName } from '@/lib/icons';
import type { ActionResult } from '@/lib/errors';

/**
 * The field shape from the reference: a recessed capsule with a small raised
 * disc carrying the icon at its left end, so the control reads as a groove with
 * a button seated in it. The label stays visible above it - placeholder-only
 * labelling vanishes the moment someone starts typing.
 */
export function IconWell({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="text-on-surface-variant pointer-events-none absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface shadow-neu-sm"
      >
        <Icon name={icon} size={19} filled={false} />
      </span>
      {children}
    </div>
  );
}

/** The password field with its show/hide control, shared with the password forms. */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  placeholder,
  error,
  invalid,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  error?: string | null;
  /** Outline the field without a message under it (the form shows one above). */
  invalid?: boolean;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor={id} emphasis required error={error} hint={hint}>
      <IconWell icon="lock">
        <Input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          enterKeyHint="go"
          required
          invalid={invalid || !!error}
          placeholder={placeholder}
          className="pl-14 pr-14"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          aria-controls={id}
          className="text-on-surface-variant hover:text-primary absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface shadow-neu-sm transition-shadow active:shadow-neu-pressed"
        >
          <Icon name={show ? 'visibility_off' : 'visibility'} size={19} filled={false} />
        </button>
      </IconWell>
    </Field>
  );
}

/**
 * One sign-in form for everyone.
 *
 * Nobody chooses "member" or "staff". A member types their member number or
 * phone; a cashier types their phone (or their email, if they use one); the
 * server works out whose account it is, checks the password, reads the role
 * from the database and opens that role's dashboard.
 */
export function LoginForm({ next, notice }: { next?: string; notice?: 'reset' | null }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signIn, null);
  const error = state && !state.ok ? state : null;

  return (
    <form action={action} className="mt-6 flex flex-col gap-4 sm:gap-5" noValidate>
      {notice === 'reset' ? (
        <Alert tone="success" title="Password changed">
          Sign in with your new password.
        </Alert>
      ) : null}

      {error && (!error.field || error.field === 'password') ? (
        <Alert tone="error">{error.error}</Alert>
      ) : null}

      <input type="hidden" name="next" value={next ?? ''} />

      <Field
        label="Member Number or Phone Number"
        htmlFor="identifier"
        emphasis
        required
        error={error?.field === 'identifier' ? error.error : null}
      >
        <IconWell icon="person">
          <Input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            invalid={error?.field === 'identifier'}
            placeholder="Member Number or Phone Number"
            className="pl-14"
          />
        </IconWell>
      </Field>

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        placeholder="Enter your password"
        invalid={error?.field === 'password'}
      />

      <div className="-mt-2 flex justify-end">
        <Link
          href="/forgot-password"
          className="text-primary h-touch-target-min inline-flex items-center rounded-full px-2 text-[13px] font-semibold hover:bg-surface hover:shadow-neu-sm"
        >
          Forgot Password?
        </Link>
      </div>

      <SubmitButton size="lg" block pendingLabel="Signing in...">
        Sign In
      </SubmitButton>
    </form>
  );
}
