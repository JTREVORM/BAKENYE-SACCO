import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import {
  getMemberFinancials,
  getSavingsPeriods,
  getUnreadCount,
} from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money, ProgressBar } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { savingDayLabel } from '@/lib/groups';
import { formatDate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { SavingsPaymentRow } from '@/types/db';

export const metadata: Metadata = { title: 'My Savings' };

/**
 * Member savings.
 *
 * A direct port of `savings_mobile/code.html`: the royal-blue total with its
 * two decorative blurs, the bento pair of Monthly Target and This Week, and
 * the Recent Deposits stack with the `south_east` inbound icon.
 *
 * The Stitch design carried a hardcoded "Yield Rate +4.2% p.a." badge. The
 * SACCO has no interest-on-savings product modelled anywhere in the brief, and
 * printing an invented rate on a member's balance would be a false financial
 * promise, so that slot now shows the current period's contribution status
 * instead — same position, same treatment, a number we can actually stand behind.
 */
export default async function SavingsPage() {
  const user = await requireMember();
  const [m, unread, weekly, monthly] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
    getSavingsPeriods(user.memberId, 'weekly', 1),
    getSavingsPeriods(user.memberId, 'monthly', 1),
  ]);

  const supabase = await createClient();
  const { data: deposits } = await supabase
    .from('savings_payments')
    .select('id, amount, paid_on, method, period_id, transaction_id')
    .eq('member_id', user.memberId)
    .order('paid_on', { ascending: false })
    .limit(8);

  const thisWeek = weekly[0] ?? null;
  const thisMonth = monthly[0] ?? null;

  return (
    <MemberShell unreadCount={unread}>
      <div className="flex flex-col gap-6 py-4">
        <h1 className="text-headline-lg font-headline-lg text-primary mb-2 hidden md:block">
          My Savings
        </h1>

        {/* Total Savings */}
        <section className="bg-primary text-on-primary relative overflow-hidden rounded-xl p-6 shadow-lg">
          <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-white opacity-10 blur-2xl" />
          <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-white opacity-5 blur-xl" />

          <p className="font-label-md text-label-md text-primary-fixed-dim relative z-10 mb-1 uppercase tracking-wider">
            Total Savings
          </p>
          <Money
            value={m?.savings_balance}
            className="font-display-currency text-display-currency relative z-10 block"
          />

          <div className="relative z-10 mt-6 flex items-end justify-between gap-3">
            <Link
              href="/savings/deposit"
              className="text-primary font-button-text text-button-text hover:bg-surface-bright h-touch-target-min flex items-center gap-2 rounded-full bg-white px-4 py-2 transition-colors"
            >
              <Icon name="add" size={20} />
              Save Money
            </Link>
            <div className="text-right">
              <p className="font-label-md text-label-md text-primary-fixed-dim mb-1">
                Deposits · Withdrawals
              </p>
              <p className="font-body-md text-body-md text-tertiary-fixed font-bold">
                {formatUGX(m?.deposits_total)} · {formatUGX(m?.withdrawals_total)}
              </p>
            </div>
          </div>
        </section>

        {/* Your group — the day you are collected from, and what you owe.
            A member who does not know their collection day cannot turn up to it. */}
        {m?.group_id ? (
          <section className="bg-surface-container-lowest border-surface-container-high elev-1 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="bg-primary-fixed text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
                <Icon name="groups" size={24} />
              </span>
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-surface-variant">Your group</p>
                <p className="font-body-lg text-body-lg text-on-surface truncate font-semibold">
                  {m.group_name}
                </p>
                <p className="font-label-md text-label-md text-on-surface-variant normal-case">
                  Collections every {savingDayLabel(m.group_saving_day)}
                </p>
              </div>
            </div>

            {toNumber(m.savings_outstanding) > 0 ? (
              <div className="text-right">
                <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">
                  Still owed
                </p>
                <Money
                  value={m.savings_outstanding}
                  className="font-headline-lg-mobile text-headline-lg-mobile text-error"
                />
              </div>
            ) : (
              <p className="font-label-md text-label-md text-tertiary flex items-center gap-1 normal-case">
                <Icon name="check_circle" size={18} />
                Up to date
              </p>
            )}
          </section>
        ) : null}

        {/* Bento pair */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Monthly Target */}
          <div className="bg-surface-container-lowest border-surface-container-high elev-1 flex flex-col justify-between rounded-xl border p-5">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-body-lg text-body-lg text-on-surface font-semibold">
                  Monthly Target
                </h3>
                <Icon name="calendar_month" className="text-outline" />
              </div>
              {thisMonth ? (
                <div className="text-body-md font-body-md mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1">
                  <span className="text-on-surface-variant">
                    Paid:{' '}
                    <strong className="text-on-surface">{formatUGX(thisMonth.paid_amount)}</strong>
                  </span>
                  <span className="text-on-surface-variant">
                    Target: {formatUGX(thisMonth.expected_amount)}
                  </span>
                </div>
              ) : (
                <p className="text-body-md font-body-md text-on-surface-variant mb-2">
                  No monthly savings plan is set up yet.
                </p>
              )}
            </div>

            {thisMonth ? (
              <div>
                <ProgressBar
                  value={percent(thisMonth.paid_amount, thisMonth.expected_amount)}
                  label="Monthly savings progress"
                  className="mb-1 h-2.5"
                />
                <p className="font-label-md text-label-md text-primary text-right normal-case">
                  {Math.round(percent(thisMonth.paid_amount, thisMonth.expected_amount))}% achieved
                  {' · '}
                  {thisMonth.period_label}
                </p>
              </div>
            ) : null}
          </div>

          {/* This Week */}
          <WeeklyCard period={thisWeek} />
        </section>

        {/* Recent Deposits */}
        <section className="mt-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
              Recent Deposits
            </h3>
            <Link
              href="/transactions?type=savings"
              className="font-button-text text-button-text text-primary flex items-center gap-1 hover:underline"
            >
              View All
              <Icon name="chevron_right" size={18} />
            </Link>
          </div>

          {!deposits || deposits.length === 0 ? (
            <div className="bg-surface-container-lowest border-surface-container-high rounded-xl border">
              <EmptyState
                icon="savings"
                title="No deposits yet"
                description="Your weekly and monthly savings will be listed here once recorded."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {deposits.map((d) => (
                <DepositCard key={d.id} deposit={d as SavingsPaymentRow} />
              ))}
            </div>
          )}
        </section>
      </div>
    </MemberShell>
  );
}

/* ------------------------------------------------------------------------ */

function WeeklyCard({
  period,
}: {
  period: { period_label: string; paid_amount: number; expected_amount: number; status: string } | null;
}) {
  const settled = period?.status === 'paid';

  // Green when the week is settled, neutral when it is not — the Stitch card is
  // always the celebratory green, which would be actively misleading on a week
  // the member has missed.
  return (
    <div
      className={clsx(
        'elev-1 flex flex-col items-start justify-center rounded-xl p-5',
        settled
          ? 'bg-tertiary-container text-on-tertiary-container'
          : 'bg-surface-container-lowest border-surface-container-high border',
      )}
    >
      <div className="mb-2 flex items-center gap-3">
        <div
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            settled
              ? 'bg-on-tertiary-fixed-variant text-tertiary-fixed'
              : 'bg-surface-container-high text-on-surface-variant',
          )}
        >
          <Icon name={settled ? 'check_circle' : 'schedule'} size={18} />
        </div>
        <h3
          className={clsx(
            'font-body-lg text-body-lg font-semibold',
            settled ? 'text-white' : 'text-on-surface',
          )}
        >
          This Week: {formatUGX(period?.paid_amount ?? 0)}
        </h3>
      </div>
      <p
        className={clsx(
          'font-body-md text-body-md ml-11',
          settled ? 'text-white opacity-80' : 'text-on-surface-variant',
        )}
      >
        {period
          ? `Weekly Target: ${formatUGX(period.expected_amount)}${
              settled ? '' : ` · ${formatUGX(Math.max(toNumber(period.expected_amount) - toNumber(period.paid_amount), 0))} to go`
            }`
          : 'No weekly savings plan is set up yet.'}
      </p>
    </div>
  );
}

function DepositCard({ deposit }: { deposit: SavingsPaymentRow }) {
  return (
    <Link
      href={deposit.transaction_id ? `/transactions/${deposit.transaction_id}` : '/transactions'}
      className="bg-surface-container-lowest border-surface-container-high elev-1 hover:bg-surface-container-low flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors"
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="bg-surface-container-low text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <Icon name="arrow_downward" />
        </div>
        <div className="min-w-0">
          <p className="font-body-lg text-body-lg text-on-surface truncate font-semibold">
            Savings Deposit
          </p>
          <div className="text-on-surface-variant font-label-md text-label-md mt-1 flex flex-wrap items-center gap-2 normal-case">
            <span>{formatDate(deposit.paid_on)}</span>
            <span className="bg-outline-variant h-1 w-1 rounded-full" />
            <span>{PAYMENT_METHOD_LABELS[deposit.method]}</span>
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <Money
          value={deposit.amount}
          sign
          className="font-button-text text-button-text text-tertiary-container font-semibold"
        />
        <span className="bg-tertiary-container/10 text-tertiary-container font-label-md text-label-md mt-1 inline-block rounded px-2 py-0.5 normal-case">
          Success
        </span>
      </div>
    </Link>
  );
}
