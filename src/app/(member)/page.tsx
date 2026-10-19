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
import { MemberHero } from '@/components/layout/Hero';
import { Icon, Money, SectionHeader } from '@/components/ui/primitives';
import { MemberStatusBadge } from '@/components/ui/status';
import { getMemberFees } from '@/lib/access-queries';
import { can } from '@/lib/rbac';
import { formatUGX } from '@/lib/money';
import { EmptyState, ListSkeleton, BalanceCardSkeleton } from '@/components/ui/states';
import { TransactionRow } from '@/components/member/TransactionRow';
import { formatDate, daysUntil } from '@/lib/format';
import { clsx } from '@/lib/clsx';

export const metadata: Metadata = { title: 'Home' };

/**
 * Member dashboard.
 *
 * The Stitch composition — savings hero, two-up Shares / Loan Balance, the
 * saved-this-month strip, Next Payment, the 3x2 action grid and the
 * transaction stack — carried into the 2026 design system, so the portal and
 * the back office are visibly one product. Every figure is the signed-in
 * member's own; nothing on this page is typed in.
 */
export default async function MemberDashboard() {
  const user = await requireMember();
  const unread = await getUnreadCount();

  return (
    <MemberShell unreadCount={unread}>
      <div className="pb-5 pt-4 md:pt-0">
        <MemberHero
          fullName={user.fullName}
          memberNo={user.memberNo}
          status={user.memberStatus ? <MemberStatusBadge status={user.memberStatus} /> : null}
        />
      </div>

      {user.memberStatus === 'pending' ? (
        <Suspense fallback={null}>
          <PendingNotice memberId={user.memberId} />
        </Suspense>
      ) : null}

      <Suspense fallback={<BalancesFallback />}>
        <Balances memberId={user.memberId} />
      </Suspense>

      <QuickActions canApply={can(user, 'portal.loan_apply')} />

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
        <div className="bg-brand-gradient text-on-primary shadow-brand relative flex h-36 flex-col justify-between overflow-hidden rounded-2xl p-5">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
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
            className="bg-surface shadow-neu card-interactive rounded-2xl p-4"
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
            className="bg-surface shadow-neu card-interactive rounded-2xl p-4"
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

      {/* Saved this month — a fact, not a demand. Savings are open, so there
          is no "next savings" falling due and nothing to chase. */}
      <section className="mb-4">
        <Link
          href="/savings"
          className="bg-surface shadow-neu card-interactive flex items-center justify-between gap-4 rounded-2xl p-4"
        >
          <div className="min-w-0">
            <h4 className="text-button-text font-button-text text-on-surface flex items-center gap-1.5">
              <Icon name="savings" size={18} className="text-primary" />
              Saved this month
            </h4>
            <p className="text-body-md font-body-md text-on-surface-variant">
              {Number(m.savings_this_month) > 0
                ? 'Save any amount, any time — there is no target.'
                : 'Nothing saved yet this month. Nothing is owed.'}
            </p>
          </div>
          <Money
            value={m.savings_this_month}
            className="text-headline-lg-mobile font-headline-lg-mobile text-primary shrink-0"
          />
        </Link>
      </section>

      {/* Next Payment — only shown when there is one, rather than a card
          reading "UGX 0" that the member has to interpret. */}
      {m.next_due_on ? (
        <section className="mb-6">
          <div
            className={clsx(
              'flex items-center justify-between gap-4 rounded-2xl p-4',
              overdue
                ? 'bg-error-container ring-error/25 shadow-neu ring-1 ring-inset'
                : 'bg-surface shadow-neu',
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
        <div className="bg-surface-container-high h-24 rounded-2xl" />
        <div className="bg-surface-container-high h-24 rounded-2xl" />
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

function QuickActions({ canApply }: { canApply: boolean }) {
  return (
    <section className="mb-6">
      <h3 className="text-button-text font-button-text text-on-surface mb-3">Quick Actions</h3>
      <div className="gap-unit grid grid-cols-3">
        {ACTIONS.filter((a) => canApply || a.href !== '/loans/apply').map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="bg-surface shadow-neu card-interactive flex h-24 flex-col items-center justify-center gap-2 rounded-2xl p-3"
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
      <div className="bg-surface rounded-2xl shadow-neu">
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

/* ------------------------------------------------------------------------ */

/** "Friday" within the coming week, otherwise the date. */

/** Why a newly registered member is pending, from their own fee charges. */
async function PendingNotice({ memberId }: { memberId: string }) {
  const fees = await getMemberFees(memberId);
  const owed = fees.filter((f) => f.status === 'unpaid' && f.is_mandatory && f.charged_at_registration);
  const total = owed.reduce((sum, f) => sum + Number(f.amount), 0);

  return (
    <section className="bg-primary-fixed text-on-primary-fixed-variant mb-6 flex items-start gap-3 rounded-2xl p-4">
      <Icon name="pending_actions" size={22} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-button-text">Your membership is pending</p>
        <p className="text-body-md mt-0.5">
          {total > 0
            ? `Registration fees of ${formatUGX(total)} (${owed.map((f) => f.fee_name).join(', ')}) are still to be paid. Your membership becomes active once the SACCO records the payment.`
            : 'The SACCO office will activate your membership shortly.'}
        </p>
      </div>
    </section>
  );
}
