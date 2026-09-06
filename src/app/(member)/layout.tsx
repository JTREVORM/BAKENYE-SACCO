import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { isStaff } from '@/lib/rbac';

/**
 * The member area.
 *
 * Every page below this layout is scoped to one person's money. The guard here
 * establishes *who*; RLS in Postgres is what actually stops anyone reading
 * anyone else's rows.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Staff have their own workspace. Sending them here would show an empty
  // dashboard, since they have no member record to scope to.
  if (isStaff(user.role) && !user.memberId) redirect('/staff');

  return <>{children}</>;
}
