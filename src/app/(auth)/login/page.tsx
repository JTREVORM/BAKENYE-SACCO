import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/auth';
import { landingPath } from '@/lib/rbac';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign-in: one form for everyone - see `LoginForm`. The brand panel and the
 * footer live in `AuthShell`, shared with the password screens.
 *
 * Someone already signed in, with an account in good standing, goes straight
 * to their own dashboard. A session belonging to a suspended or switched-off
 * account counts as signed out, so it sees the form rather than a redirect
 * loop.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;
  const current = await getSessionUser();
  if (current) redirect(current.mustChangePassword ? '/change-password' : landingPath(current));

  return (
    <AuthShell>
      <div className="bg-surface rounded-[32px] p-5 shadow-neu-lg sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span className="bg-surface flex h-[84px] w-[84px] items-center justify-center rounded-full p-3 shadow-neu sm:h-[96px] sm:w-[96px]">
            <Image
              src="/brand/bnd-logo.png"
              alt="Bakenye Unity and Development SACCO"
              width={96}
              height={96}
              priority
              className="h-full w-full object-contain"
            />
          </span>

          <h1 className="text-on-surface mt-4 text-[24px] font-extrabold leading-tight tracking-tight sm:text-[28px]">
            Welcome Back
          </h1>
          <p className="text-on-surface-variant mt-1 text-[13px] leading-snug sm:text-[14px]">
            Sign in to access your SACCO account
          </p>
        </div>

        <LoginForm
          next={next}
          notice={reset === 'done' ? 'reset' : null}
        />

        {/* The assurance, pressed into the sheet rather than laid on top of it,
            so it reads as a footnote to the form and not as a second card. */}
        <div className="bg-surface-container mt-7 flex items-start gap-3 rounded-3xl p-3.5 shadow-neu-inset-sm">
          <span className="bg-surface text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-neu-sm">
            <Icon name="verified_user" size={19} />
          </span>
          <div className="min-w-0">
            <p className="text-on-surface text-[13.5px] font-bold">
              Your information is safe with us.
            </p>
            <p className="text-on-surface-variant mt-0.5 text-[12.5px] leading-snug">
              Nobody at the SACCO can see your password, and never asks for it.
            </p>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
