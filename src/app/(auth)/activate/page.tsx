import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { getRules } from '@/lib/settings';
import { ActivateForm } from './ActivateForm';

export const metadata: Metadata = { title: 'Set up your account' };

/**
 * Set up your account - or choose a new password.
 *
 * When the SACCO registers a member (or creates a staff account), the officer
 * is shown a one-time setup code, once, and hands it over. The account holder
 * comes here, proves who they are with their member number or phone and that
 * code, and chooses their own password. A reset issued at the office works the
 * same way. The officer never learns the password.
 */
export default async function ActivatePage() {
  const rules = await getRules();
  const min = Math.max(8, Math.round(rules.passwordMinLength));

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

        <Icon name="key" size={30} className="text-primary" filled={false} />
        <h1 className="text-on-surface mt-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Set up your account
        </h1>
        <p className="text-on-surface-variant mt-2 text-[14px] leading-relaxed sm:text-[15px]">
          Use the setup code the SACCO office gave you to choose your own password. The same page
          works for a reset code.
        </p>

        <ActivateForm minLength={min} />
      </div>
    </AuthShell>
  );
}
