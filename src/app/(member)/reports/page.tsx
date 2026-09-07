import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getUnreadCount } from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money } from '@/components/ui/primitives';
import { monthStart, toISODate } from '@/lib/format';
import type { IconName } from '@/lib/icons';

export const metadata: Metadata = { title: 'Reports' };

/**
 * Member reports centre.
 *
 * A port of `reports_center_mobile/code.html`: the summary tiles across the top
 * and the report list beneath, each row with a view action.
 *
 * Stitch drew a separate download icon on every row. Downloading is the same
 * gesture as viewing followed by Print → Save as PDF, and a second button that
 * silently does the first button's job is a false affordance, so each row now
 * opens the real, printable document instead.
 */
export default async function MemberReportsPage() {
  const user = await requireMember();
  const [m, unread] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
  ]);

  const today = new Date();
  const yearStart = `${today.getFullYear()}-01-01`;
  const quarterStart = monthStart(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const now = toISODate(today);

  const reports: {
    icon: IconName;
    title: string;
    description: string;
    href: string;
  }[] = [
    {
      icon: 'description',
      title: 'Member Statement',
      description: 'Savings, deposits and withdrawals with a running balance.',
      href: `/statements?from=${quarterStart}&to=${now}`,
    },
    {
      icon: 'account_balance_wallet',
      title: 'Savings Summary',
      description: 'Your weekly and monthly contribution record.',
      href: '/savings',
    },
    {
      icon: 'pie_chart',
      title: 'Share Record',
      description: 'Every share purchase and your current holding.',
      href: '/shares',
    },
    {
      icon: 'payments',
      title: 'Loan History',
      description: 'Applications, disbursements and repayments.',
      href: '/loans',
    },
    {
      icon: 'receipt_long',
      title: `Annual Statement ${today.getFullYear()}`,
      description: 'Everything from 1 January to today.',
      href: `/statements?from=${yearStart}&to=${now}`,
    },
  ];

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-6 py-4">
        <div>
          <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
            Reports Center
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant mt-1">
            View, print or download a record of your account.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Tile label="Savings" value={m?.savings_balance} icon="account_balance_wallet" />
          <Tile label="Shares" value={m?.share_value} icon="pie_chart" />
          <Tile label="Loans" value={m?.loan_balance} icon="payments" />
        </div>

        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <Link
              key={r.title}
              href={r.href}
              className="bg-surface border-outline-variant shadow-card hover:bg-surface-container-low flex items-center gap-3 rounded-xl border p-4 transition-colors"
            >
              <div className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                <Icon name={r.icon} size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
                  {r.title}
                </h2>
                <p className="text-body-md font-body-md text-on-surface-variant">{r.description}</p>
              </div>
              <Icon name="chevron_right" size={20} className="text-on-surface-variant shrink-0" />
            </Link>
          ))}
        </div>

        <p className="text-label-md font-label-md text-on-surface-variant text-center normal-case">
          Open a report, then use Print or Save PDF to keep a copy.
        </p>
      </div>
    </MemberShell>
  );
}

function Tile({ label, value, icon }: { label: string; value: unknown; icon: IconName }) {
  return (
    <div className="bg-surface-container border-surface-container-high rounded-xl border p-3">
      <Icon name={icon} size={20} className="text-on-surface-variant" />
      <p className="text-label-md font-label-md text-on-surface-variant mt-2">{label}</p>
      <Money
        value={value}
        className="text-body-md font-body-md text-on-surface mt-0.5 block font-bold"
      />
    </div>
  );
}
