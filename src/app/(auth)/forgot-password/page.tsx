import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Forgot password' };

/**
 * Forgot password.
 *
 * Two routes back in, because many members have no email:
 *
 *   - An account with an email address gets a reset link by email.
 *   - Anyone else asks the SACCO office. After checking who they are, staff
 *     issue a new temporary password, which must be changed at the next
 *     sign-in - so nobody at the SACCO ends up knowing the password in use.
 *
 * The form answers the same way whatever is typed, so it cannot be used to
 * find out which member numbers or phone numbers exist.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <div className="bg-surface rounded-[32px] p-5 shadow-neu-lg sm:p-8">
        <Link
          href="/login"
          className="text-primary hover:bg-surface-container-high h-touch-target-min -ml-2 mb-4 inline-flex items-center gap-2 rounded-lg px-2 text-[15px] font-semibold"
        >
          <Icon name="arrow_back" size={20} />
          Back to sign in
        </Link>

        <Icon name="lock_open" size={30} className="text-primary" filled={false} />
        <h1 className="text-on-surface mt-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Forgot your password?
        </h1>
        <p className="text-on-surface-variant mt-2 text-[14px] leading-relaxed sm:text-[15px]">
          Enter the member number, phone number or email you sign in with.
        </p>

        <ForgotPasswordForm />

        <ul className="mt-7 flex flex-col gap-3">
          <Tip icon="storefront" title="No email? Visit the SACCO office">
            Bring your National ID. After confirming who you are, staff give you a new temporary
            password. Sign in with it and you will be asked to choose your own straight away.
          </Tip>
        </ul>
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
