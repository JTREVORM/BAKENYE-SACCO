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
 * a button seated in it.
 *
 * The disc is decorative — the field keeps its own visible label above, which
 * the reference does without. Placeholder-only labelling disappears the moment
 * someone starts typing, and this is the one screen in the product a first-time
 * member meets with no idea what a "member number" looks like.
 */
function IconWell({ icon, children }: { icon: IconName; children: React.ReactNode }) {
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

export function LoginForm({ next, resetDone }: { next?: string; resetDone?: boolean }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signIn, null);
  const [showPassword, setShowPassword] = useState(false);

  const error = state && !state.ok ? state : null;

  return (
    <form action={action} className="mt-6 flex flex-col gap-4 sm:gap-5" noValidate>
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
        emphasis
        required
        error={error?.field === 'identifier' ? error.error : null}
        hint="Members can sign in with their number, e.g. BND-M-0000123."
      >
        <IconWell icon="person">
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
            className="pl-14"
          />
        </IconWell>
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        emphasis
        required
        error={error?.field === 'password' ? error.error : null}
      >
        <IconWell icon="lock">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            enterKeyHint="go"
            required
            invalid={error?.field === 'password'}
            placeholder="Enter your password"
            className="pl-14 pr-14"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="text-on-surface-variant hover:text-primary absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface shadow-neu-sm transition-shadow active:shadow-neu-pressed"
          >
            <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={19} filled={false} />
          </button>
        </IconWell>
      </Field>

      <SubmitButton size="lg" block className="mt-1" pendingLabel="Signing in…">
        Sign In
      </SubmitButton>

      {/* The reference's closing line: the two ways out of a failed sign-in, on
          one row under the button. Each is padded to a 44px target — a 13px
          text link is well below the minimum in DESIGN.md and is exactly what a
          frustrated member is jabbing at one-handed. */}
      <p className="text-on-surface-variant flex flex-wrap items-center justify-center gap-x-1 text-[13px]">
        <Link
          href="/forgot-password"
          className="text-primary h-touch-target-min inline-flex items-center rounded-full px-2 font-semibold hover:bg-surface hover:shadow-neu-sm"
        >
          Forgot password?
        </Link>
        <span className="font-semibold">or</span>
        <Link
          href="/help"
          className="text-primary h-touch-target-min inline-flex items-center rounded-full px-2 font-semibold hover:bg-surface hover:shadow-neu-sm"
        >
          Need help?
        </Link>
      </p>
    </form>
  );
}
