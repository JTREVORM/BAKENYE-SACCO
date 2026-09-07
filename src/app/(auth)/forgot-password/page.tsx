import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <div className="bg-surface-container-lowest rounded-[22px] p-9 shadow-[0_18px_50px_-12px_rgba(10,38,96,0.28)]">
        <Link
          href="/login"
          className="text-primary hover:bg-surface-container-high h-touch-target-min -ml-2 mb-4 inline-flex items-center gap-2 rounded-lg px-2 text-[15px] font-semibold"
        >
          <Icon name="arrow_back" size={20} />
          Back to sign in
        </Link>

        <Icon name="lock" size={34} className="text-primary" filled={false} />

        <h1 className="text-on-surface mt-3 text-[36px] font-extrabold leading-tight tracking-tight">
          Reset your password
        </h1>
        <p className="text-on-surface-variant mt-2 text-base leading-relaxed">
          Enter the email address on your BND-SACCO account and we will send you a link to set a new
          password.
        </p>

        <ForgotPasswordForm />

        <p className="text-on-surface-variant mt-8 text-[14px] leading-relaxed">
          If you registered without an email address, please call or visit the SACCO office to have
          your password reset.
        </p>
      </div>
    </AuthShell>
  );
}
