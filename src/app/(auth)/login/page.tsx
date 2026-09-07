import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { Icon } from '@/components/ui/primitives';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign-in.
 *
 * The brand panel and the footer live in `AuthShell`, shared with the password
 * screens. This route owns only the card: the greeting, the form, and the two
 * things a member who cannot get in needs next.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;

  return (
    <AuthShell>
      <div className="bg-surface-container-lowest rounded-[22px] p-9 shadow-[0_18px_50px_-12px_rgba(10,38,96,0.28)]">
        <Icon name="person" size={38} className="text-primary mb-3" filled={false} />
        <h1 className="text-on-surface text-[40px] font-extrabold leading-tight tracking-tight">
          Welcome Back
        </h1>

        <p className="text-on-surface-variant mt-2 text-base leading-relaxed">
          Sign in to access your account and manage your SACCO services.
        </p>

        <LoginForm next={next} resetDone={reset === 'done'} />

        {/* "Not registered yet?" is a rule with a caption on it, exactly as a
            divider between the form and the help below it. */}
        <div className="mt-7 flex items-center gap-4">
          <span className="bg-outline-variant/60 h-px flex-1" />
          <span className="text-on-surface-variant shrink-0 text-sm">
            Not registered yet?
          </span>
          <span className="bg-outline-variant/60 h-px flex-1" />
        </div>

        <p className="mt-3 text-center">
          <Link
            href="/help"
            className="text-primary hover:bg-surface-container-high h-touch-target-min inline-flex items-center rounded-lg px-3 text-[15px] font-semibold underline"
          >
            Need help signing in?
          </Link>
        </p>

        <div className="bg-primary-fixed/60 mt-6 flex items-start gap-3 rounded-xl p-4">
          <span className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Icon name="verified_user" size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-primary text-[15px] font-bold">
              Your information is safe with us.
            </p>
            <p className="text-on-surface-variant mt-0.5 text-sm leading-snug">
              We use industry-standard security measures to protect your data.
            </p>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
