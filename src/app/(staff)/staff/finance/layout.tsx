import { requirePermission } from '@/lib/auth';
import { STAFF_NAV, visibleNav } from '@/lib/rbac';
import { FinanceNav } from '@/components/finance/FinanceNav';

/**
 * The Finance section: Cash at Merchant, Cash at Bank, Cash at Hand and
 * everything that moves money between them. Every page below re-checks its
 * own permission; this guard stops anyone without `finance.view` reaching
 * any of them, and the database's `can_view_finance()` stops them a third time.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission('finance.view');
  const finance = visibleNav(user, STAFF_NAV).find((i) => i.href === '/staff/finance');

  return (
    <>
      {finance?.children?.length ? <FinanceNav items={finance.children} /> : null}
      {children}
    </>
  );
}
