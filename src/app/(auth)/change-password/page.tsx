import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { getSessionUser } from '@/lib/auth';
import { landingPath } from '@/lib/rbac';
import { getRules } from '@/lib/settings';
import { FirstPasswordForm } from './FirstPasswordForm';

export const metadata: Metadata = { title: 'Choose your password' };

/**
 * Choose your password - the first thing anyone sees after signing in with a
 * temporary password.
 *
 * Every protected page sends an account on a temporary password here, and the
 * database gives such an account nothing until it is changed, so there is no
 * way past this screen but to choose a password.
 */
export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.mustChangePassword) redirect(landingPath(user));

  const rules = await getRules();
  const min = Math.max(8, Math.round(rules.passwordMinLength));
  const first = user.fullName.trim().split(/\s+/)[0];

  return (
    <AuthShell>
      <div className="bg-surface rounded-[32px] p-5 shadow-neu-lg sm:p-8">
        <Icon name="key" size={30} className="text-primary" filled={false} />
        <h1 className="text-on-surface mt-3 text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">
          Choose your password
        </h1>
        <p className="text-on-surface-variant mt-2 text-[14px] leading-relaxed sm:text-[15px]">
          Welcome, {first}. You signed in with a temporary password from the SACCO. Choose your own now -
          nobody at the SACCO will know it.
        </p>
        <p className="text-on-surface-variant mt-2 text-[13px]">
          {user.memberNo ? (
            <>
              From now on, sign in with <span className="font-mono">{user.memberNo}</span> or your phone
              number, and this new password.
            </>
          ) : (
            'From now on, sign in with your phone number or email and this new password.'
          )}
        </p>

        <FirstPasswordForm minLength={min} />

        <form method="post" action="/auth/signout" className="mt-4 text-center">
          <button
            type="submit"
            className="text-on-surface-variant h-touch-target-min text-[13px] font-semibold hover:text-primary"
          >
            Not you? Sign out
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
