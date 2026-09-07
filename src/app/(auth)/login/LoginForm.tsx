'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { signIn } from '../actions';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import type { ActionResult } from '@/lib/errors';

export function LoginForm({ next, resetDone }: { next?: string; resetDone?: boolean }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signIn, null);
  const [showPassword, setShowPassword] = useState(false);

  const error = state && !state.ok ? state : null;

  return (
    <form action={action} className="mt-5 flex flex-col gap-4 sm:mt-6 sm:gap-5" noValidate>
      {resetDone ? (
        <Alert tone="success" title="Password changed">
          Sign in with your new password.
        </Alert>
      ) : null}

      {error && !error.field ? <Alert tone="error">{error.error}</Alert> : null}

      <input type="hidden" name="next" value={next ?? ''} />

      <Field
        label="Email or Member Number"
        htmlFor="identifier"
        icon="person"
        emphasis
        required
        error={error?.field === 'identifier' ? error.error : null}
        hint="Members can sign in with their number, e.g. BND-M-0000123."
      >
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          invalid={error?.field === 'identifier'}
          placeholder="you@example.com or BND-M-0000123"
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        icon="lock"
        emphasis
        required
        error={error?.field === 'password' ? error.error : null}
      >
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            enterKeyHint="go"
            required
            invalid={error?.field === 'password'}
            placeholder="Enter your password"
            className="pr-14"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="text-primary hover:bg-surface-container-high absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full"
          >
            <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={20} filled={false} />
          </button>
        </div>
      </Field>

      <div className="-mt-2 flex justify-end">
        {/* Padded to a 44px-high target — a 16px-tall text link is below the
            minimum in DESIGN.md and hard to hit one-handed. */}
        <Link
          href="/forgot-password"
          className="text-label-md font-label-md text-primary hover:bg-surface-container-high h-touch-target-min -mr-2 flex items-center rounded-lg px-2 text-[14px] normal-case"
        >
          Forgot your password?
        </Link>
      </div>

      <SubmitButton size="lg" block icon="login" pendingLabel="Signing in…">
        Sign In
      </SubmitButton>
    </form>
  );
}
