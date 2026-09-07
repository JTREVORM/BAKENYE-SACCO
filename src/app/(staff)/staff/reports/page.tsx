import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { monthStart, toISODate } from '@/lib/format';
import type { IconName } from '@/lib/icons';
import type { Permission } from '@/lib/rbac';

export const metadata: Metadata = { title: 'Reports' };

/**
 * Reports centre.
 *
 * Every report resolves to a live screen with date filters, print and
 * CSV export — nothing here is a placeholder. Reports the signed-in role
 * cannot access are not listed, rather than listed and then refused.
 */
export default async function StaffReportsPage() {
  const user = await requirePermission('reports.view');

  const today = new Date();
  const from = monthStart(today);
  const to = toISODate(today);
  const yearStart = `${today.getFullYear()}-01-01`;

  const groups: {
    heading: string;
    reports: {
      icon: IconName;
      title: string;
      description: string;
      href: string;
      permission?: Permission;
    }[];
  }[] = [
    {
      heading: 'Membership',
      reports: [
        {
          icon: 'group',
          title: 'Member register',
          description: 'Every member with their savings, shares and loan position.',
          href: '/staff/reports/members',
          permission: 'members.view',
        },
        {
          icon: 'description',
          title: 'Member statement',
          description: 'A single member’s savings movements over a period.',
          href: '/staff/reports/statement',
          permission: 'reports.member',
        },
      ],
    },
    {
      heading: 'Groups & collections',
      reports: [
        {
          icon: 'groups',
          title: 'Group report',
          description: 'Expected, collected and outstanding for one group, member by member.',
          href: '/staff/reports/groups',
          permission: 'groups.view',
        },
        {
          icon: 'event_available',
          title: 'Today’s collections',
          description: 'Every group whose saving day falls today, with live progress.',
          href: '/staff/savings/today',
          permission: 'savings.view',
        },
        {
          icon: 'calendar_month',
          title: 'Savings schedules',
          description: 'Every scheduled contribution — paid, partial, missed or waived.',
          href: '/staff/savings/schedules',
          permission: 'savings.view',
        },
        {
          icon: 'warning',
          title: 'Savings arrears',
          description: 'Schedules whose due date passed with nothing recorded.',
          href: '/staff/savings/schedules?status=missed',
          permission: 'savings.view',
        },
      ],
    },
    {
      heading: 'Savings & shares',
      reports: [
        {
          icon: 'account_balance_wallet',
          title: 'Weekly savings performance',
          description: 'Expected against collected, per member, by week.',
          href: `/staff/savings?kind=weekly&from=${from}&to=${to}`,
          permission: 'savings.view',
        },
        {
          icon: 'calendar_month',
          title: 'Monthly savings performance',
          description: 'Expected against collected, per member, by month.',
          href: `/staff/savings?kind=monthly&from=${from}&to=${to}`,
          permission: 'savings.view',
        },
        {
          icon: 'pie_chart',
          title: 'Share capital register',
          description: 'Total capital and every shareholder’s stake.',
          href: '/staff/shares',
          permission: 'shares.view',
        },
      ],
    },
    {
      heading: 'Loans',
      reports: [
        {
          icon: 'payments',
          title: 'Loan portfolio',
          description: 'Every loan, at every stage of its life.',
          href: '/staff/loans',
          permission: 'loans.view',
        },
        {
          icon: 'credit_score',
          title: 'Active loans',
          description: 'Disbursed loans still being repaid.',
          href: '/staff/loans?status=active',
          permission: 'loans.view',
        },
        {
          icon: 'warning',
          title: 'Overdue loans',
          description: 'Loans behind on their repayment schedule.',
          href: '/staff/loans?status=overdue',
          permission: 'loans.view',
        },
        {
          icon: 'receipt',
          title: 'Loan repayments',
          description: 'Every repayment received, filterable by date.',
          href: '/staff/transactions?type=loan_repayment',
          permission: 'transactions.view',
        },
      ],
    },
    {
      heading: 'Finance',
      reports: [
        {
          icon: 'account_balance',
          title: 'Cashbook',
          description: 'Income and expenses by category for a period.',
          href: `/staff/finance?tab=summary&from=${from}&to=${to}`,
          permission: 'finance.view',
        },
        {
          icon: 'trending_up',
          title: 'Income report',
          description: 'Every income entry with its source.',
          href: `/staff/finance?tab=income&from=${from}&to=${to}`,
          permission: 'finance.view',
        },
        {
          icon: 'trending_down',
          title: 'Expense report',
          description: 'Expenses, including what is awaiting approval.',
          href: `/staff/finance?tab=expenses&from=${from}&to=${to}`,
          permission: 'finance.view',
        },
        {
          icon: 'assessment',
          title: 'Profit & loss (year to date)',
          description: 'Surplus or deficit since the start of the year.',
          href: `/staff/finance?tab=summary&from=${yearStart}&to=${to}`,
          permission: 'finance.view',
        },
      ],
    },
    {
      heading: 'Governance',
      reports: [
        {
          icon: 'receipt_long',
          title: 'Transaction register',
          description: 'The complete ledger, including reversals.',
          href: '/staff/transactions',
          permission: 'transactions.view',
        },
        {
          icon: 'policy',
          title: 'Audit log',
          description: 'Who changed what, when, and why.',
          href: '/staff/audit',
          permission: 'audit.view',
        },
      ],
    },
  ];

  const visible = groups
    .map((g) => ({
      ...g,
      reports: g.reports.filter((r) => !r.permission || can(user.role, r.permission)),
    }))
    .filter((g) => g.reports.length > 0);

  return (
    <div>
      <PageTitle
        title="Reports"
        subtitle="Open a report, filter it by date, then print or export."
      />

      <div className="flex flex-col gap-8">
        {visible.map((g) => (
          <section key={g.heading}>
            <h2 className="mb-3 flex items-center gap-2 text-title-md text-on-surface after:h-px after:flex-1 after:bg-outline-variant after:content-['']">
              {g.heading}
            </h2>
            <div className="gap-gutter grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {g.reports.map((r) => (
                <Link
                  key={r.href + r.title}
                  href={r.href}
                  className="bg-surface shadow-neu hover:shadow-card-hover active:shadow-neu-pressed flex items-start gap-3 rounded-2xl p-4 transition-shadow"
                >
                  <span className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                    <Icon name={r.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-body-lg font-body-lg text-on-surface block font-semibold">
                      {r.title}
                    </span>
                    <span className="text-body-md font-body-md text-on-surface-variant mt-0.5 block">
                      {r.description}
                    </span>
                  </span>
                  <Icon name="chevron_right" size={20} className="text-on-surface-variant shrink-0" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
