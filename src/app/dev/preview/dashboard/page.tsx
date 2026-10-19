import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { StaffShell } from '@/components/layout/StaffShell';
import { BrandHero, HeroFigures, WelcomeHero } from '@/components/layout/Hero';
import { TransactionsPanel } from '@/components/staff/RecentTransactions';
import { ActivityPanel } from '@/components/staff/FinancialActivity';
import { KpiCard, KpiCardFeature, Money } from '@/components/ui/primitives';
import { STAFF_NAV } from '@/lib/rbac';
import { FIXTURE_MONTHLY_FLOW, FIXTURE_TRANSACTIONS, FIXTURE_TREND } from '@/lib/fixtures';
import { formatUGX } from '@/lib/money';
import dashboardStyles from '@/components/staff/SuperAdminDashboard.module.css';
import overviewStyles from '@/components/staff/OverviewDashboard.module.css';

export const metadata: Metadata = { title: 'Dashboard preview', robots: { index: false } };

/**
 * Design QA harness for the dashboards — development only.
 *
 * Renders the real chrome (navigation rail, command bar) and the real dashboard
 * components against `src/lib/fixtures.ts`, so the redesign can be inspected
 * and screenshotted at every width without a database and without signing in.
 * It is the fixture counterpart to `scripts/ui-shots.mjs`, which does the same
 * against the live application.
 *
 * `?variant=admin` renders the administration banner instead of the overview
 * one — the two faces the approved references specify.
 *
 * It 404s outside development, so it cannot be reached in production even if
 * the route is deployed.
 */
export default async function DashboardPreview({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  const { variant } = await searchParams;
  const admin = variant === 'admin';

  const savings = FIXTURE_TREND.map((t) => t.savings);
  const shares = FIXTURE_TREND.map((t) => t.shares);

  const funds = (
    <section
      aria-label="SACCO funds"
      className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4"
    >
      <KpiCardFeature
        icon="wallet"
        label="Total SACCO funds"
        value={<Money value={6730000} />}
        footnote="As at 19 Oct 2026"
        href="/staff/finance"
      />
      <KpiCard
        icon="smartphone"
        tone="accent"
        label="Cash at Merchant"
        value={<Money value={485000} />}
        footnote="As at 19 Oct 2026"
        href="/staff/finance/merchant"
      />
      <KpiCard
        icon="account_balance"
        tone="primary"
        label="Cash at Bank"
        value={<Money value={4145000} />}
        footnote="As at 19 Oct 2026"
        href="/staff/finance/bank"
      />
      <KpiCard
        icon="payments"
        tone="success"
        label="Cash at Hand"
        value={<Money value={2100000} />}
        footnote="As at 19 Oct 2026"
        href="/staff/finance/cash"
      />
    </section>
  );

  return (
    <div className={admin ? dashboardStyles.dashboard : overviewStyles.overview}>
    <StaffShell
      user={{ fullName: 'MWESIGWA TREVOR JOSEPH', roleName: 'Super Admin', photoUrl: null }}
      nav={STAFF_NAV.map(item => item.label === 'Dashboard' ? { ...item, href: '/dev/preview/dashboard' } : item)}
      unreadCount={3}
    >
      <div data-admin-dashboard data-overview-dashboard={!admin || undefined} className="space-y-gutter">
        {admin ? (
          <WelcomeHero
            roleName="Super Admin"
            fullName="MWESIGWA TREVOR JOSEPH"
            subtitle="Accounts, security and configuration"
          />
        ) : (
          <BrandHero
            eyebrow="Super Admin Dashboard"
            nameTop="BAKENYE UNITY AND"
            nameBottom="DEVELOPMENT SACCO"
            description="Your savings, our priority. Together we build a stronger and more prosperous community."
            figures={
              <HeroFigures
                figures={[
                  { icon: 'group', label: 'Active Members', value: '56', href: '/staff/members' },
                  {
                    icon: 'savings',
                    label: 'Total Savings',
                    value: formatUGX(1120000),
                    href: '/staff/savings',
                  },
                  {
                    icon: 'payments',
                    label: 'Loans Outstanding',
                    value: formatUGX(0),
                    href: '/staff/loans',
                  },
                ]}
              />
            }
          />
        )}

        {admin ? (
          <section aria-label="Accounts and sign-in" className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4">
            <KpiCard
              icon="manage_accounts"
              tone="primary"
              label="Active staff accounts"
              value={4}
              footnote="56 member logins"
              href="/staff/users"
            />
            <KpiCard
              icon="key"
              tone="warning"
              label="On a temporary password"
              value={17}
              footnote="Must choose their own at next sign-in"
            />
            <KpiCard
              icon="login"
              tone="success"
              label="Sign-ins, last 24 hours"
              value={8}
              footnote="1 failed attempt"
            />
            <KpiCard
              icon="lock"
              label="Identifiers paused now"
              value={0}
              footnote="Every member has a login"
            />
          </section>
        ) : (
          <section data-overview-metrics aria-label="SACCO overview" className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4">
            <KpiCard
              icon="group"
              tone="primary"
              label="Active Members"
              value="56"
              footnote="45 joined this month"
              trend="up"
              href="/staff/members"
            />
            <KpiCard
              icon="pie_chart"
              tone="primary"
              label="Share Capital"
              value={<Money value={4300000} compact />}
              footnote="Member equity held"
              series={shares}
              href="/staff/shares"
            />
            <KpiCard
              icon="account_balance_wallet"
              tone="success"
              label="Total Savings"
              value={<Money value={1120000} compact />}
              footnote={`${formatUGX(240000)} saved this month`}
              trend="up"
              series={savings}
              href="/staff/savings"
            />
            <KpiCard
              icon="payments"
              tone="warning"
              label="Active Loans"
              value={<Money value={0} compact />}
              footnote="0 loans running"
              href="/staff/loans"
            />
          </section>
        )}

        {admin ? funds : null}

        <div data-admin-panels className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <TransactionsPanel rows={FIXTURE_TRANSACTIONS} />
          </div>
          <div className="min-w-0">
            <ActivityPanel
              compact
              series={FIXTURE_MONTHLY_FLOW}
              months={6}
              baseHref="/dev/preview/dashboard"
            />
          </div>
        </div>
        {!admin ? funds : null}
      </div>
    </StaffShell>
    </div>
  );
}
