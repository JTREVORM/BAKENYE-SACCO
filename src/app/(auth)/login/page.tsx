import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginScene } from './LoginScene';
import { getSessionUser } from '@/lib/auth';
import { landingPath } from '@/lib/rbac';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign-in: one form for everyone, with a login-only presentation shell.
 *
 * Someone already signed in, with an account in good standing, goes straight
 * to their own dashboard. A session belonging to a suspended or switched-off
 * account counts as signed out, so it sees the form rather than a redirect
 * loop.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; reason?: string; error?: string }>;
}) {
  const { next, reset, reason, error } = await searchParams;
  const current = await getSessionUser();
  if (current) redirect(current.mustChangePassword ? '/change-password' : landingPath(current));

  return (
    <LoginScene>
      <LoginForm
        next={next}
        notice={
          reset === 'done' ? 'reset'
            : reason === 'timeout' ? 'timeout'
            : error === 'link_expired' ? 'link_expired'
            : null
        }
      />
    </LoginScene>
  );
}
