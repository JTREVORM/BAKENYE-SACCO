import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Set a new password' };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <div className="bg-surface-container-lowest rounded-[22px] p-9 shadow-[0_18px_50px_-12px_rgba(10,38,96,0.28)]">
        <Icon name="lock_open" size={34} className="text-primary" filled={false} />

        <h1 className="text-on-surface mt-3 text-[36px] font-extrabold leading-tight tracking-tight">
          Set a new password
        </h1>
        <p className="text-on-surface-variant mt-2 text-base leading-relaxed">
          Choose a password you have not used on this account before.
        </p>

        <ResetPasswordForm />
      </div>
    </AuthShell>
  );
}
