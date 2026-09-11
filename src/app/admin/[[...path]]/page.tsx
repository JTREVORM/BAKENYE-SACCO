import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { landingPath } from '@/lib/rbac';

/**
 * `/admin` - a guess people type. There is no separate admin site: a signed-in
 * person goes to their own dashboard (a member to theirs, never the back
 * office), and anyone else to sign in. What each page shows is decided by
 * permissions on that page and, underneath, in the database.
 */
export default async function AdminRedirect() {
  const user = await getSessionUser();
  redirect(user ? landingPath(user) : '/login?next=/staff');
}
