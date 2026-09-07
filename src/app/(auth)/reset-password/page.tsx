import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Set a new password' };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <div className="bg-surface-container-lowest rounded-[20px] p-5 shadow-[0_18px_50px_-12px_rgba(10,38,96,0.28)] sm:p-7">
        <Icon name="lock_open" size={30} className="text-primary" filled={false} />

        <h1 className="text-on-surface mt-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Set a new password
        </h1>
        <p className="text-on-surface-variant mt-2 text-[14px] leading-relaxed sm:text-[15px]">
          Choose a password you have not used on this account before.
        </p>

        <ResetPasswordForm />
      </div>
    </AuthShell>
  );
}
