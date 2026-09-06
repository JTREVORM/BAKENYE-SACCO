'use client';

import { useFormStatus } from 'react-dom';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/form';

/**
 * Sign out.
 *
 * Deliberately a server action rather than a browser `supabase.auth.signOut()`.
 * Calling the client SDK here would pull `@supabase/supabase-js` into the
 * bundle of every page that renders the app shell — roughly 70KB of JavaScript
 * on a low-end Android phone, to clear a cookie the server can clear for free.
 */
export function SignOutButton({ label = 'Log Out' }: { label?: string }) {
  return (
    <form action={signOut}>
      <SignOutSubmit label={label} />
    </form>
  );
}

function SignOutSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      block
      icon="logout"
      loading={pending}
      className="text-error border-error/40 hover:bg-error-container"
    >
      {pending ? 'Signing out…' : label}
    </Button>
  );
}
