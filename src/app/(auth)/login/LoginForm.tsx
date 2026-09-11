'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { signInMember, signInStaff } from '../actions';
import { Field, Input, SubmitButton } from '@/components/ui/form';
import { Alert } from '@/components/ui/states';
import { Icon } from '@/components/ui/primitives';
import { clsx } from '@/lib/clsx';
import type { IconName } from '@/lib/icons';
import type { ActionResult } from '@/lib/errors';

/**
 * The field shape from the reference: a recessed capsule with a small raised
 * disc carrying the icon at its left end, so the control reads as a groove with
 * a button seated in it. The label stays visible above it - this is the one
 * screen a first-time member meets with no idea what a member number looks like.
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

type Audience = 'member' | 'staff';

/**
 * Two ways in, because the SACCO has two kinds of user.
 *
 * Members - most of whom have no email address - sign in with their member
 * number and the phone number on their SACCO record. Staff sign in with an
 * email and password. The member tab comes first: members are the many.
 */
export function LoginForm({
  next,
  resetDone,
  initial = 'member',
}: {
  next?: string;
  resetDone?: boolean;
  initial?: Audience;
}) {
  const [audience, setAudience] = useState<Audience>(initial);

  return (
    <div className="mt-6 flex flex-col gap-4 sm:gap-5">
      <div
        role="tablist"
        aria-label="Who is signing in"
        className="bg-surface-container grid grid-cols-2 gap-1 rounded-full p-1 shadow-neu-inset-sm"
      >
        {(['member', 'staff'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={audience === a}
            aria-controls={`login-${a}`}
            onClick={() => setAudience(a)}
            className={clsx(
              'h-touch-target-min inline-flex items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-[background-color,box-shadow]',
              audience === a
                ? 'bg-surface text-primary shadow-neu-sm'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            <Icon name={a === 'member' ? 'badge' : 'shield_person'} size={18} filled={false} />
            {a === 'member' ? 'Member' : 'Staff'}
          </button>
        ))}
      </div>

      {resetDone ? (
        <Alert tone="success" title="Password changed">
          Sign in on the Staff tab with your new password.
        </Alert>
      ) : null}

      <div id={`login-${audience}`} role="tabpanel">
        {audience === 'member' ? <MemberForm next={next} /> : <StaffForm next={next} />}
      </div>
    </div>
  );
}

function MemberForm({ next }: { next?: string }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signInMember, null);
  const error = state && !state.ok ? state : null;

  return (
    <form action={action} className="flex flex-col gap-4 sm:gap-5" noValidate>
      {error && !error.field ? <Alert tone="error">{error.error}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ''} />

      <Field
        label="Member number"
        htmlFor="member_no"
        emphasis
        required
        error={error?.field === 'member_no' ? error.error : null}
        hint="On your passbook and receipts, e.g. BND-M-0000123."
      >
        <IconWell icon="badge">
          <Input
            id="member_no"
            name="member_no"
            type="text"
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            invalid={error?.field === 'member_no'}
            placeholder="BND-M-0000123"
            className="tabular pl-14"
          />
        </IconWell>
      </Field>

      <Field
        label="Phone number"
        htmlFor="phone"
        emphasis
        required
        error={error?.field === 'phone' ? error.error : null}
        hint="The number registered with the SACCO."
      >
        <IconWell icon="phone">
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="go"
            required
            invalid={error?.field === 'phone'}
            placeholder="0772 123 456"
            className="tabular pl-14"
          />
        </IconWell>
      </Field>

      <SubmitButton size="lg" block className="mt-1" pendingLabel="Signing in…">
        Sign In
      </SubmitButton>

      <p className="text-on-surface-variant text-center text-[13px] leading-snug">
        No password needed. Changed your phone number?{' '}
        <Link href="/forgot-password" className="text-primary font-semibold underline-offset-2 hover:underline">
          Here is what to do
        </Link>
        .
      </p>
    </form>
  );
}

function StaffForm({ next }: { next?: string }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(signInStaff, null);
  const [showPassword, setShowPassword] = useState(false);
  const error = state && !state.ok ? state : null;

  return (
    <form action={action} className="flex flex-col gap-4 sm:gap-5" noValidate>
      {error && !error.field ? <Alert tone="error">{error.error}</Alert> : null}
      <input type="hidden" name="next" value={next ?? ''} />

      <Field
        label="Email"
        htmlFor="email"
        emphasis
        required
        error={error?.field === 'email' ? error.error : null}
      >
        <IconWell icon="mail">
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            invalid={error?.field === 'email'}
            placeholder="you@example.com"
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

      <p className="text-on-surface-variant flex flex-wrap items-center justify-center gap-x-1 text-[13px]">
        <Link
          href="/forgot-password?as=staff"
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
