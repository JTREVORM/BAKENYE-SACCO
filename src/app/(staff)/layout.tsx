import { requireStaff } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { STAFF_NAV, visibleNav } from '@/lib/rbac';
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
  const nav = visibleNav(user, STAFF_NAV);

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
