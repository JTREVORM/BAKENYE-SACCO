import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { Icon, Money, Avatar, ProgressBar, Badge } from '@/components/ui/primitives';
import { Alert, EmptyState, ErrorState, ListSkeleton, TableSkeleton, StatGridSkeleton } from '@/components/ui/states';
import { LoanStatusBadge, MemberStatusBadge, SavingsStatusBadge, TxnStatusBadge } from '@/components/ui/status';
import { TransactionRow } from '@/components/member/TransactionRow';
import { Receipt } from '@/components/Receipt';
import { TrendChart } from '@/components/staff/TrendChart';
import { MembersBrowser } from '@/app/(staff)/staff/members/MembersBrowser';
import { LoansBrowser } from '@/app/(staff)/staff/loans/LoansBrowser';
import { GroupsBrowser } from '@/components/groups/GroupsBrowser';
import { CollectionSheet } from '@/components/collections/CollectionSheet';
import { PreviewControls } from './PreviewControls';

import {
  FIXTURE_COLLECTION_SHEET,
  FIXTURE_GROUPS,
  FIXTURE_GROUP_OVERVIEWS,
  FIXTURE_LOAN_BALANCE,
  FIXTURE_MEMBERS,
  FIXTURE_PORTFOLIO,
  FIXTURE_RECEIPT,
  FIXTURE_TRANSACTIONS,
  FIXTURE_TREND,
} from '@/lib/fixtures';
import { formatUGX } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = { title: 'Design preview', robots: { index: false } };

/**
 * Design QA harness — development only.
 *
 * Renders the real components against `src/lib/fixtures.ts` so every screen can
 * be inspected and screenshotted at 320px through 1920px without a database.
 * It is how the responsive pass in `docs/RESPONSIVE.md` was actually carried
 * out, and it is the fastest way to re-check a layout after changing a shared
 * component.
 *
 * It 404s outside development, so it cannot be reached in production even if
 * the route is deployed.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="bg-background min-h-[100dvh] pb-20">
      <header className="bg-primary text-on-primary px-container-margin-mobile py-3">
        <p className="text-button-text font-button-text">BUD-SACCO · design preview</p>
        <p className="text-label-md font-label-md text-primary-fixed-dim normal-case">
          Development only. Fixture data — nothing here touches the database.
        </p>
      </header>

      <div className="px-container-margin-mobile mx-auto flex max-w-6xl flex-col gap-10 py-6">
        <PreviewControls />

        {/* ---------------------------------------------------- member home */}
        <Section id="member-dashboard" title="Member dashboard" note="member_dashboard_mobile">
          <div className="mx-auto w-full max-w-2xl">
            <section className="py-4">
              <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
                Hello, Christine 👋
              </h2>
              <p className="text-body-md font-body-md text-on-surface-variant">
                Here is your financial overview.
              </p>
            </section>

            <section className="gap-unit mb-6 flex flex-col">
              <div className="bg-primary text-on-primary shadow-pop relative flex h-32 flex-col justify-between overflow-hidden rounded-xl p-4">
                <div className="pointer-events-none absolute -right-4 -top-4 h-32 w-32 rounded-full bg-white opacity-5 blur-xl" />
                <div>
                  <p className="text-body-md font-body-md opacity-90">Total Savings</p>
                  <Money
                    value={FIXTURE_MEMBERS[0].savings_balance}
                    className="text-display-currency font-display-currency mt-1 block"
                  />
                </div>
                <span className="text-label-md font-label-md flex items-center gap-1 normal-case opacity-80">
                  View details <Icon name="chevron_right" size={16} />
                </span>
              </div>

              <div className="gap-unit grid grid-cols-2">
                <div className="bg-surface-container-high border-surface-container-highest shadow-card rounded-xl border p-4">
                  <p className="text-label-md font-label-md text-on-surface-variant">Shares</p>
                  <Money
                    value={FIXTURE_MEMBERS[0].share_value}
                    className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mt-1 block"
                  />
                  <p className="text-label-md font-label-md text-on-surface-variant/80 mt-0.5 normal-case">
                    10 shares
                  </p>
                </div>
                <div className="bg-surface-container-high border-surface-container-highest shadow-card rounded-xl border p-4">
                  <p className="text-label-md font-label-md text-on-surface-variant">Loan Balance</p>
                  <Money
                    value={FIXTURE_MEMBERS[0].loan_balance}
                    className="text-headline-lg-mobile font-headline-lg-mobile text-error mt-1 block"
                  />
                  <p className="text-label-md font-label-md text-on-surface-variant/80 mt-0.5 normal-case">
                    1 active loan
                  </p>
                </div>
              </div>
            </section>

            <section className="mb-6">
              <div className="border-error bg-error-container shadow-card flex items-center justify-between rounded-xl border p-4">
                <div className="min-w-0">
                  <h4 className="text-button-text font-button-text text-on-surface flex items-center gap-1.5">
                    <Icon name="warning" size={18} className="text-error" />
                    Payment Overdue
                  </h4>
                  <p className="text-body-md font-body-md text-on-surface-variant">
                    Was due {formatDate('2026-08-15')}
                  </p>
                </div>
                <Money
                  value={150000}
                  className="text-headline-lg-mobile font-headline-lg-mobile text-error shrink-0"
                />
              </div>
            </section>

            <section className="mb-6">
              <h3 className="text-button-text font-button-text text-on-surface mb-3">
                Quick Actions
              </h3>
              <div className="gap-unit grid grid-cols-3">
                {[
                  ['savings', 'Save Money', 'bg-primary-container text-on-primary-container'],
                  ['pie_chart', 'Buy Shares', 'bg-secondary-container text-on-secondary-container'],
                  ['request_quote', 'Apply Loan', 'bg-tertiary-container text-white'],
                  ['payments', 'Repay Loan', 'bg-error-container text-error'],
                  ['receipt_long', 'Statement', 'bg-surface-container-high text-on-surface-variant'],
                  ['notifications_active', 'Alerts', 'bg-surface-container-high text-on-surface-variant'],
                ].map(([icon, label, tone]) => (
                  <div
                    key={label}
                    className="bg-surface-container flex h-24 flex-col items-center justify-center gap-2 rounded-lg p-3"
                  >
                    <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full', tone)}>
                      <Icon name={icon} />
                    </span>
                    <span className="text-label-md font-label-md text-on-surface text-center normal-case">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-button-text font-button-text text-on-surface mb-3">
                Recent Transactions
              </h3>
              <div className="flex flex-col gap-2">
                {FIXTURE_TRANSACTIONS.slice(0, 3).map((t) => (
                  <TransactionRow key={t.id} txn={t} />
                ))}
              </div>
            </section>
          </div>
        </Section>

        {/* -------------------------------------------------- staff members */}
        <Section id="staff-members" title="Staff · member register" note="members_staff_mobile + desktop table">
          <MembersBrowser
            rows={FIXTURE_MEMBERS}
            total={FIXTURE_MEMBERS.length}
            page={1}
            pageSize={20}
            canRegister
            groups={FIXTURE_GROUPS}
          />
        </Section>

        {/* --------------------------------------------------- staff groups */}
        <Section
          id="staff-groups"
          title="Staff · group register"
          note="Each group carries its own saving day"
        >
          <GroupsBrowser
            rows={FIXTURE_GROUP_OVERVIEWS}
            total={FIXTURE_GROUP_OVERVIEWS.length}
            page={1}
            pageSize={20}
            canManage
          />
        </Section>

        {/* ----------------------------------------------- collection sheet */}
        <Section
          id="staff-collections"
          title="Staff · collection sheet"
          note="The screen a cashier works from on a saving day"
        >
          <CollectionSheet sheet={FIXTURE_COLLECTION_SHEET} canRecord canWaive />
        </Section>

        {/* ---------------------------------------------------- staff loans */}
        <Section id="staff-loans" title="Staff · loan portfolio">
          <LoansBrowser
            rows={FIXTURE_PORTFOLIO}
            total={FIXTURE_PORTFOLIO.length}
            page={1}
            pageSize={25}
            canReview
          />
        </Section>

        {/* ------------------------------------------------------- loan card */}
        <Section id="member-loan" title="Member · active loan card" note="loans_mobile">
          <div className="mx-auto w-full max-w-2xl">
            <div className="bg-primary relative overflow-hidden rounded-xl p-5 shadow-[0_4px_12px_rgba(14,52,131,0.15)]">
              <div className="bg-primary-container pointer-events-none absolute right-0 top-0 -mr-10 -mt-10 h-32 w-32 rounded-full opacity-50 blur-2xl" />
              <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-label-md font-label-md text-primary-fixed mb-1 block">
                    Business Loan · {FIXTURE_LOAN_BALANCE.loan_no}
                  </span>
                  <Money
                    value={FIXTURE_LOAN_BALANCE.outstanding}
                    className="text-display-currency font-display-currency text-on-primary block"
                  />
                  <span className="text-body-md font-body-md text-primary-fixed-dim">
                    Outstanding Balance
                  </span>
                </div>
                <div className="bg-error-container text-on-error-container border-error text-label-md font-label-md flex shrink-0 items-center gap-1 rounded border px-2 py-1 shadow-sm">
                  <span className="bg-error h-1.5 w-1.5 rounded-full" />
                  Overdue
                </div>
              </div>

              <div className="relative z-10 mb-4">
                <div className="text-label-md font-label-md text-on-primary mb-1 flex justify-between">
                  <span>Progress</span>
                  <span>49% Paid</span>
                </div>
                <div className="bg-primary-container h-2 w-full overflow-hidden rounded-full">
                  <div className="bg-secondary-container h-2 rounded-full" style={{ width: '49%' }} />
                </div>
                <div className="text-label-md font-label-md text-primary-fixed-dim mt-1 flex justify-between gap-2 normal-case">
                  <span>{formatUGX(FIXTURE_LOAN_BALANCE.amount_paid)} paid</span>
                  <span>Total: {formatUGX(FIXTURE_LOAN_BALANCE.total_payable)}</span>
                </div>
              </div>

              <div className="bg-primary-container border-primary-fixed-dim/20 relative z-10 mb-5 flex items-center justify-between gap-3 rounded-lg border bg-opacity-50 p-3">
                <div className="min-w-0">
                  <span className="text-label-md font-label-md text-primary-fixed block">
                    Overdue amount
                  </span>
                  <Money
                    value={FIXTURE_LOAN_BALANCE.overdue_amount}
                    className="text-body-lg font-body-lg text-on-primary font-bold"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 text-right">
                  <Icon name="calendar_today" size={20} className="text-secondary-fixed" />
                  <div>
                    <span className="text-label-md font-label-md text-primary-fixed block">
                      Due Date
                    </span>
                    <span className="text-body-md font-body-md text-on-primary font-semibold">
                      {formatDate(FIXTURE_LOAN_BALANCE.next_due_on)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative z-10 flex gap-3">
                <span className="bg-secondary-container text-on-secondary-container text-button-text font-button-text h-touch-target-min flex flex-1 items-center justify-center rounded-lg shadow-sm">
                  Make Repayment
                </span>
                <span className="border-primary-fixed text-primary-fixed text-button-text font-button-text h-touch-target-min flex flex-1 items-center justify-center rounded-lg border">
                  View Schedule
                </span>
              </div>
            </div>
          </div>
        </Section>

        {/* --------------------------------------------------------- receipt */}
        <Section id="receipt" title="Transaction receipt" note="transaction_receipt_mobile">
          <Receipt payload={FIXTURE_RECEIPT} />
        </Section>

        {/* ----------------------------------------------------- staff stats */}
        <Section id="staff-dashboard" title="Staff · dashboard stats" note="staff_dashboard_desktop">
          <div className="flex flex-col gap-6">
            <div className="gap-gutter grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-surface shadow-card flex flex-col justify-between rounded-xl p-5">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="bg-primary-container/20 text-primary-container rounded-lg p-2">
                    <Icon name="group" />
                  </div>
                  <span className="text-tertiary bg-tertiary-fixed-dim/30 font-label-md text-label-md flex items-center rounded-full px-2 py-0.5 normal-case">
                    <Icon name="trending_up" size={14} className="mr-1" />
                    +18 this month
                  </span>
                </div>
                <div>
                  <div className="text-on-surface-variant text-label-md font-label-md mb-1">
                    Total Members
                  </div>
                  <div className="text-display-currency font-display-currency text-on-surface">
                    1,245
                  </div>
                </div>
              </div>

              <div className="bg-primary text-on-primary border-primary relative flex flex-col justify-between overflow-hidden rounded-xl border p-5 shadow-[0_4px_12px_rgba(14,52,131,0.2)]">
                <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10 blur-xl" />
                <div className="relative z-10 mb-4 flex items-start justify-between">
                  <div className="rounded-lg bg-white/20 p-2 backdrop-blur-sm">
                    <Icon name="pie_chart" className="text-white" />
                  </div>
                </div>
                <div className="relative z-10">
                  <div className="text-primary-fixed-dim text-label-md font-label-md mb-1">
                    Share Capital
                  </div>
                  <Money
                    value={125400000}
                    compact
                    className="text-display-currency font-display-currency text-white"
                  />
                </div>
              </div>

              <div className="bg-surface shadow-card flex flex-col justify-between rounded-xl p-5">
                <div className="mb-4">
                  <div className="bg-secondary-container/30 text-on-secondary-container w-fit rounded-lg p-2">
                    <Icon name="account_balance_wallet" />
                  </div>
                </div>
                <div>
                  <div className="text-on-surface-variant text-label-md font-label-md mb-1">
                    Total Savings
                  </div>
                  <Money
                    value={348700000}
                    compact
                    className="text-display-currency font-display-currency text-on-surface"
                  />
                </div>
              </div>

              <div className="bg-surface shadow-card flex flex-col justify-between rounded-xl p-5">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="bg-error-container/30 text-on-error-container rounded-lg p-2">
                    <Icon name="payments" />
                  </div>
                  <span className="text-on-surface-variant bg-surface-container font-label-md text-label-md rounded-full px-2 py-0.5 normal-case">
                    48 active
                  </span>
                </div>
                <div>
                  <div className="text-on-surface-variant text-label-md font-label-md mb-1">
                    Active Loans
                  </div>
                  <Money
                    value={214200000}
                    compact
                    className="text-display-currency font-display-currency text-on-surface"
                  />
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest grid grid-cols-2 gap-4 rounded-xl p-4 shadow-sm md:grid-cols-4">
              {[
                ['Outstanding Loans', 86500000, 'text-on-surface'],
                ["Today's Collections", 3800000, 'text-tertiary-container'],
                ['Income (MTD)', 15400000, 'text-on-surface'],
                ['Expenses (MTD)', 6800000, 'text-error'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="p-3">
                  <div className="text-label-md font-label-md text-on-surface-variant mb-1">
                    {label as string}
                  </div>
                  <Money
                    value={value}
                    className={clsx(
                      'text-headline-lg-mobile font-headline-lg-mobile font-semibold',
                      tone as string,
                    )}
                  />
                </div>
              ))}
            </div>

            <div className="bg-surface shadow-card overflow-hidden rounded-xl">
              <div className="border-outline-variant bg-surface border-b p-5">
                <h2 className="text-button-text font-button-text text-on-surface font-bold">
                  Collections
                </h2>
              </div>
              <div className="p-5">
                <TrendChart points={FIXTURE_TREND} />
              </div>
            </div>
          </div>
        </Section>

        {/* -------------------------------------------------- states */}
        <Section id="states" title="Loading, empty and error states">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="bg-surface rounded-xl shadow-neu-sm">
              <EmptyState
                icon="receipt_long"
                title="No transactions yet"
                description="Your transactions will appear here."
              />
            </div>
            <div className="bg-surface rounded-xl shadow-neu-sm">
              <ErrorState />
            </div>
            <ListSkeleton rows={3} />
            <StatGridSkeleton count={2} />
            <div className="lg:col-span-2">
              <TableSkeleton rows={3} cols={5} />
            </div>
          </div>
        </Section>

        <Section id="alerts" title="Alerts and badges">
          <div className="flex flex-col gap-3">
            <Alert tone="success" title="Transaction successful">
              Receipt BND-TX-2026-004582 has been issued.
            </Alert>
            <Alert tone="warning" title="This loan is overdue">
              UGX 150,000 is past due by 16 days.
            </Alert>
            <Alert tone="error" title="Transaction not completed">
              Payment of UGX 2,000,000 exceeds the outstanding balance of UGX 1,200,000.
            </Alert>
            <Alert tone="info">
              Expenses need a manager&rsquo;s approval before any money leaves the SACCO.
            </Alert>

            <div className="flex flex-wrap gap-2 pt-2">
              <LoanStatusBadge status="applied" />
              <LoanStatusBadge status="under_review" />
              <LoanStatusBadge status="approved" />
              <LoanStatusBadge status="active" />
              <LoanStatusBadge status="completed" />
              <LoanStatusBadge status="rejected" />
              <MemberStatusBadge status="active" />
              <MemberStatusBadge status="suspended" />
              <SavingsStatusBadge status="paid" />
              <SavingsStatusBadge status="partial" />
              <SavingsStatusBadge status="missed" />
              <TxnStatusBadge status="posted" />
              <TxnStatusBadge status="reversed" />
              <Badge tone="info">Info</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Avatar name="Nakabugo Christine Ssemakula" size={56} />
              <Avatar name="Wanyama Peter" size={40} />
              <Avatar name="A" size={32} />
              <div className="w-40">
                <ProgressBar value={49} label="Loan progress" />
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-preview-section={id} className="scroll-mt-24">
      <div className="border-outline-variant mb-4 border-b pb-2">
        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-primary">{title}</h2>
        {note ? (
          <p className="text-label-md font-label-md text-on-surface-variant normal-case">
            Source: {note}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
