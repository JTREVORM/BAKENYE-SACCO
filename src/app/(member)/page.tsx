import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import {
  getMemberFinancials,
  getRecentTransactions,
  getUnreadCount,
} from '@/lib/queries';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money, SectionHeader } from '@/components/ui/primitives';
import { EmptyState, ListSkeleton, BalanceCardSkeleton } from '@/components/ui/states';
import { TransactionRow } from '@/components/member/TransactionRow';
import { formatDate, daysUntil } from '@/lib/format';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = { title: 'Home' };

/**
 * Member dashboard.
 *
 * This is `member_dashboard_mobile/code.html` with the hardcoded figures
 * replaced by the signed-in member's own. Every class, every card, every
 * gradient blob is the one Stitch exported — the greeting, the royal-blue
 * savings hero, the two-up Shares / Loan Balance grid, the Next Payment strip,
 * the 3x2 quick-action grid, and the recent-transaction stack.
 */
export default async function MemberDashboard() {
  const user = await requireMember();
  const unread = await getUnreadCount();

  return (
    <MemberShell unreadCount={unread}>
      {/* Greeting */}
      <section className="py-4">
        <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
          Hello, {user.fullName.split(' ')[0]} 👋
        </h2>
        <p className="text-body-md font-body-md text-on-surface-variant">
          Here is your financial overview.
        </p>
      </section>

      <Suspense fallback={<BalancesFallback />}>
        <Balances memberId={user.memberId} />
      </Suspense>

      <QuickActions />

      <section className="mb-6">
        <SectionHeader
          title="Recent Transactions"
          action={
            <Link href="/transactions" className="text-label-md font-label-md text-primary normal-case">
              View All
            </Link>
          }
        />
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <RecentTransactions memberId={user.memberId} />
        </Suspense>
      </section>
    </MemberShell>
  );
}

/* ------------------------------------------------------------------------ */

async function Balances({ memberId }: { memberId: string }) {
  const m = await getMemberFinancials(memberId);
  if (!m) return <BalancesFallback />;

  const dueIn = daysUntil(m.next_due_on);
  const overdue = Number(m.overdue_amount) > 0;

  return (
    <>
      <section className="gap-unit mb-6 flex flex-col">
        {/* Total Savings — the royal-blue hero card. */}
        <div className="bg-primary text-on-primary shadow-pop relative flex h-32 flex-col justify-between overflow-hidden rounded-xl p-4">
          <div className="pointer-events-none absolute -right-4 -top-4 h-32 w-32 rounded-full bg-white opacity-5 blur-xl" />
          <div>
            <p className="text-body-md font-body-md opacity-90">Total Savings</p>
            <Money
              value={m.savings_balance}
              className="text-display-currency font-display-currency mt-1 block"
            />
          </div>
          <Link
            href="/savings"
            className="text-label-md font-label-md flex items-center gap-1 normal-case opacity-80"
          >
            <span>View details</span>
            <Icon name="chevron_right" size={16} />
          </Link>
        </div>

        <div className="gap-unit grid grid-cols-2">
          <Link
            href="/shares"
            className="bg-surface-container-high border-surface-container-highest shadow-card rounded-xl border p-4"
          >
            <p className="text-label-md font-label-md text-on-surface-variant">Shares</p>
            <Money
              value={m.share_value}
              className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mt-1 block"
            />
            <p className="text-label-md font-label-md text-on-surface-variant/80 mt-0.5 normal-case">
              {m.share_count} {m.share_count === 1 ? 'share' : 'shares'}
            </p>
          </Link>

          <Link
            href="/loans"
            className="bg-surface-container-high border-surface-container-highest shadow-card rounded-xl border p-4"
          >
            <p className="text-label-md font-label-md text-on-surface-variant">Loan Balance</p>
            <Money
              value={m.loan_balance}
              className={clsx(
                'text-headline-lg-mobile font-headline-lg-mobile mt-1 block',
                Number(m.loan_balance) > 0 ? 'text-error' : 'text-on-surface',
              )}
            />
            <p className="text-label-md font-label-md text-on-surface-variant/80 mt-0.5 normal-case">
              {m.active_loans === 0
                ? 'No active loan'
                : `${m.active_loans} active ${m.active_loans === 1 ? 'loan' : 'loans'}`}
            </p>
          </Link>
        </div>
      </section>

      {/* Next Payment — only shown when there is one, rather than a card
          reading "UGX 0" that the member has to interpret. */}
      {m.next_due_on ? (
        <section className="mb-6">
          <div
            className={clsx(
              'shadow-card flex items-center justify-between rounded-xl border p-4',
              overdue ? 'border-error bg-error-container' : 'border-outline-variant bg-surface',
            )}
          >
            <div className="min-w-0">
              <h4 className="text-button-text font-button-text text-on-surface flex items-center gap-1.5">
                {overdue ? (
                  <Icon name="warning" size={18} className="text-error" />
                ) : null}
                {overdue ? 'Payment Overdue' : 'Next Payment'}
              </h4>
              <p className="text-body-md font-body-md text-on-surface-variant">
                {overdue ? 'Was due ' : 'Due '}
                {formatDate(m.next_due_on)}
                {!overdue && dueIn !== null && dueIn >= 0
                  ? dueIn === 0
                    ? ' · today'
                    : ` · in ${dueIn} day${dueIn === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <Money
                value={overdue ? m.overdue_amount : m.next_due_amount}
                className={clsx(
                  'text-headline-lg-mobile font-headline-lg-mobile',
                  overdue ? 'text-error' : 'text-primary',
                )}
              />
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function BalancesFallback() {
  return (
    <div className="gap-unit mb-6 flex flex-col">
      <BalanceCardSkeleton />
      <div className="gap-unit grid grid-cols-2">
        <div className="bg-surface-container-high h-24 rounded-xl" />
        <div className="bg-surface-container-high h-24 rounded-xl" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The 3x2 action grid, with each tile's colour ramp exactly as Stitch set it.
 * Every tile is now a real destination.
 */
const ACTIONS = [
  { href: '/savings/deposit', icon: 'savings', label: 'Save Money', tone: 'bg-primary-container text-on-primary-container' },
  { href: '/shares/buy', icon: 'pie_chart', label: 'Buy Shares', tone: 'bg-secondary-container text-on-secondary-container' },
  { href: '/loans/apply', icon: 'request_quote', label: 'Apply Loan', tone: 'bg-tertiary-container text-white' },
  { href: '/loans/repay', icon: 'payments', label: 'Repay Loan', tone: 'bg-error-container text-error' },
  { href: '/statements', icon: 'receipt_long', label: 'Statement', tone: 'bg-surface-container-high text-on-surface-variant' },
  { href: '/notifications', icon: 'notifications_active', label: 'Alerts', tone: 'bg-surface-container-high text-on-surface-variant' },
] as const;

function QuickActions() {
  return (
    <section className="mb-6">
      <h3 className="text-button-text font-button-text text-on-surface mb-3">Quick Actions</h3>
      <div className="gap-unit grid grid-cols-3">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="bg-surface-container hover:bg-surface-container-highest flex h-24 flex-col items-center justify-center gap-2 rounded-lg p-3 transition-colors"
          >
            <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full', a.tone)}>
              <Icon name={a.icon} />
            </span>
            <span className="text-label-md font-label-md text-on-surface text-center normal-case">
              {a.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

async function RecentTransactions({ memberId }: { memberId: string }) {
  const rows = await getRecentTransactions(memberId, 5);

  if (rows.length === 0) {
    return (
      <div className="bg-surface rounded-xl shadow-neu-sm">
        <EmptyState
          icon="receipt_long"
          title="No transactions yet"
          description="Your savings, share purchases and loan payments will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((t) => (
        <TransactionRow key={t.id} txn={t} href={`/transactions/${t.id}`} />
      ))}
    </div>
  );
}
