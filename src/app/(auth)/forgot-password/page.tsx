import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Trouble signing in' };

/**
 * Trouble signing in.
 *
 * Members have no password to reset: they sign in with their member number and
 * the phone number on their SACCO record. What goes wrong for a member is a
 * lost or changed phone number, and the only safe fix for that is a person at
 * the office who can check who they are and update the record - which is what
 * this page tells them. Staff still reset a password by email.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const { as } = await searchParams;
  const staff = as === 'staff';

  return (
    <AuthShell>
      <div className="bg-surface rounded-[32px] p-5 shadow-neu-lg sm:p-8">
        <Link
          href={staff ? '/login?as=staff' : '/login'}
          className="text-primary hover:bg-surface-container-high h-touch-target-min -ml-2 mb-4 inline-flex items-center gap-2 rounded-lg px-2 text-[15px] font-semibold"
        >
          <Icon name="arrow_back" size={20} />
          Back to sign in
        </Link>

        {staff ? (
          <>
            <Icon name="lock" size={30} className="text-primary" filled={false} />
            <h1 className="text-on-surface mt-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
              Reset your staff password
            </h1>
            <p className="text-on-surface-variant mt-2 text-[14px] leading-relaxed sm:text-[15px]">
              Enter the email address of your staff account and we will send you a link to set a
              new password.
            </p>
            <ForgotPasswordForm />
            <p className="text-on-surface-variant mt-8 text-[14px] leading-relaxed">
              Are you a member?{' '}
              <Link href="/forgot-password" className="text-primary font-semibold hover:underline">
                Members do not use a password
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <Icon name="badge" size={30} className="text-primary" filled={false} />
            <h1 className="text-on-surface mt-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
              Members don&apos;t need a password
            </h1>
            <p className="text-on-surface-variant mt-2 text-[14px] leading-relaxed sm:text-[15px]">
              Sign in with your <strong className="text-on-surface">member number</strong> and the{' '}
              <strong className="text-on-surface">phone number registered with the SACCO</strong>.
            </p>

            <ul className="mt-6 flex flex-col gap-3">
              <Tip icon="badge" title="Can't find your member number?">
                It is printed on your passbook and on every receipt, and looks like BND-M-0000123.
                The office can also look it up for you.
              </Tip>
              <Tip icon="phone" title="Changed or lost your phone number?">
                Visit the SACCO office with your National ID. Staff will confirm who you are and
                update your record; you can sign in with the new number straight away.
              </Tip>
              <Tip icon="schedule" title="Sign-in paused after too many tries?">
                Wait for the time shown on the sign-in screen, or ask at the office.
              </Tip>
            </ul>

            <Link
              href="/login"
              className="bg-ink text-white h-touch-target-primary text-button-text mt-7 flex items-center justify-center rounded-full font-semibold shadow-neu-dark"
            >
              Back to sign in
            </Link>

            <p className="text-on-surface-variant mt-6 text-[14px] leading-relaxed">
              SACCO staff?{' '}
              <Link href="/forgot-password?as=staff" className="text-primary font-semibold hover:underline">
                Reset your staff password
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </AuthShell>
  );
}

function Tip({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <li className="bg-surface-container flex items-start gap-3 rounded-3xl p-3.5 shadow-neu-inset-sm">
      <span className="bg-surface text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-neu-sm">
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-on-surface text-[14px] font-bold">{title}</p>
        <p className="text-on-surface-variant mt-0.5 text-[13px] leading-snug">{children}</p>
      </div>
    </li>
  );
}
