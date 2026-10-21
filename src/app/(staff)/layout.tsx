import { requireStaff } from '@/lib/auth';
import { getBrand } from '@/lib/brand';
import { getUnreadCount } from '@/lib/queries';
import { STAFF_NAV, can, landingPath, visibleNav } from '@/lib/rbac';
import { StaffShell } from '@/components/layout/StaffShell';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

/**
 * The staff workspace.
 *
 * The sidebar is built from `visibleNav()`, so a cashier simply does not see
 * "Users" or "Audit Log" — they are not rendered as links that bounce. Each
 * page below re-checks its own permission with `requirePermission()`, and RLS
 * checks it again in the database.
 *
 * Staff are offered the app here, the same way members are offered it in their
 * own layout: mounted on the layout rather than a page, so it survives moving
 * around the workspace, and shown once per sign-in to somebody who has not
 * installed it. A teller opening the workspace from a home-screen icon starts
 * the day a step sooner.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const [unread, brand] = await Promise.all([getUnreadCount(), getBrand()]);
  // "Dashboard" opens this person's own dashboard - the cashier desk, the
  // loans desk, administration - rather than one page for everyone.
  const home = landingPath(user);
  const nav = visibleNav(user, STAFF_NAV).map((item) =>
    item.href === '/staff' && item.label === 'Dashboard' ? { ...item, href: home } : item,
  );

  return (
    <StaffShell
      user={{ fullName: user.fullName, roleName: user.roleName, role: user.role, photoUrl: user.photoUrl }}
      nav={nav}
      unreadCount={unread}
      showRecordSaving={can(user, 'savings.record')}
    >
      {children}
      <InstallPrompt appName={brand.shortName} legalName={brand.legalName} />
    </StaffShell>
  );
}
