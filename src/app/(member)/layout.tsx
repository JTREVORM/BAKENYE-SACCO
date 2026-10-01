import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getBrand } from '@/lib/brand';
import { isStaff } from '@/lib/rbac';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

/**
 * The member area.
 *
 * Every page below this layout is scoped to one person's money. The guard here
 * establishes *who*; RLS in Postgres is what actually stops anyone reading
 * anyone else's rows.
 *
 * It is also where members - and only members - are offered the app on their
 * device. The offer is armed by their own sign-in and shown once; it is mounted
 * here rather than on a page so it survives moving around the portal, and it
 * never runs for staff, who have no layout in common with it.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = await getBrand();

  // Staff have their own workspace. Sending them here would show an empty
  // dashboard, since they have no member record to scope to.
  if (isStaff(user) && !user.memberId) redirect('/staff');

  return (
    <>
      {children}
      <InstallPrompt appName={brand.shortName} legalName={brand.legalName} />
    </>
  );
}
