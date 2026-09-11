import { requireStaff } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { STAFF_NAV, landingPath, visibleNav } from '@/lib/rbac';
import { StaffShell } from '@/components/layout/StaffShell';

/**
 * The staff workspace.
 *
 * The sidebar is built from `visibleNav()`, so a cashier simply does not see
 * "Users" or "Audit Log" — they are not rendered as links that bounce. Each
 * page below re-checks its own permission with `requirePermission()`, and RLS
 * checks it again in the database.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const unread = await getUnreadCount();
  // "Dashboard" opens this person's own dashboard - the cashier desk, the
  // loans desk, administration - rather than one page for everyone.
  const home = landingPath(user);
  const nav = visibleNav(user, STAFF_NAV).map((item) =>
    item.href === '/staff' && item.label === 'Dashboard' ? { ...item, href: home } : item,
  );

  return (
    <StaffShell
      user={{ fullName: user.fullName, roleName: user.roleName, photoUrl: user.photoUrl }}
      nav={nav}
      unreadCount={unread}
    >
      {children}
    </StaffShell>
  );
}
