import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import {
  getMemberFinancials,
  getMemberSchedules,
  getShareUnitPrice,
  getUnreadCount,
} from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Icon, Money } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { depositCount, shareCount } from '@/lib/savings';
import { formatDate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import type { MemberFinancialsRow, SavingsPaymentRow, SavingsScheduleRow } from '@/types/db';

export const metadata: Metadata = { title: 'My Savings' };

/**
 * Member savings.
 *
 * Monthly savings are open: a member saves whatever they choose, whenever they
 * choose, and a month they skip is not a debt. So this page carries no target,
 * no "amount remaining", no progress bar against an expectation and no saver
 * tier. What it shows instead is what a member actually asks: how much they
 * have in total, how much they have saved this month, the months behind that,
 * and their recent deposits.
 *
 * The layout is the one the Stitch design set — the royal-blue total with its
 * two blurs, a bento pair beneath it, then the deposit stack — because the
 * design is good and only the content of the rules has changed.
 */
export default async function SavingsPage() {
  const user = await requireMember();
  const [m, unread, months, sharePrice] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
    getMemberSchedules(user.memberId, 6),
    getShareUnitPrice(),
  ]);

  const supabase = await createClient();
  const { data: deposits } = await supabase
    .from('savings_payments')
    .select('id, amount, paid_on, method, period_id, transaction_id')
    .eq('member_id', user.memberId)
    .order('paid_on', { ascending: false })
    .limit(8);

  // Months worth showing: the ones money actually went into. A month with
  // nothing in it is not a shortfall and does not need a row of its own.
  const saved = months.filter((s) => toNumber(s.saved_amount) > 0);

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

          <p className="font-label-md text-label-md text-primary-fixed-dim relative z-10 mb-1">
            Total Savings
          </p>
          <Money
            value={m?.savings_balance}
            className="font-display-currency text-display-currency relative z-10 block"
          />

          <div className="relative z-10 mt-6 flex items-end justify-between gap-3">
            <Link
              href="/savings/deposit"
              className="text-primary font-button-text text-button-text hover:bg-surface h-touch-target-min flex items-center gap-2 rounded-full bg-white px-4 py-2 transition-colors"
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

        {/* How saving works here, said once, plainly. */}
        <section className="bg-surface-container-lowest border-surface-container-high shadow-card flex items-center gap-3 rounded-xl border p-5">
          <span className="bg-primary-fixed text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
            <Icon name="savings" size={24} />
          </span>
          <div className="min-w-0">
            <p className="font-body-lg text-body-lg text-on-surface font-semibold">
              Save any amount, any time
            </p>
            <p className="font-label-md text-label-md text-on-surface-variant normal-case">
              There is no monthly target. Save what suits you — a month you do not save is not
              owed, and nothing is charged for it.
            </p>
          </div>
        </section>

        {/* Bento pair: this month, and the shares held. */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ThisMonthCard member={m} months={months} />
          <SharesCard member={m} sharePrice={sharePrice} />
        </section>

        {/* Month by month. */}
        <section>
          <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-4">
            Savings by Month
          </h3>
          {saved.length === 0 ? (
            <div className="bg-surface-container-lowest border-surface-container-high rounded-xl border">
              <EmptyState
                icon="calendar_month"
                title="No savings yet"
                description="Each month you save in will appear here with its total."
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {saved.map((month) => (
                <li
                  key={month.schedule_id}
                  className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
                >
                  <div className="min-w-0">
                    <p className="font-body-lg text-body-lg text-on-surface truncate font-semibold">
                      {month.cycle}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant normal-case">
                      {depositCount(toNumber(month.deposits))}
                      {month.last_paid_on ? ` · last on ${formatDate(month.last_paid_on)}` : ''}
                    </p>
                  </div>
                  <Money
                    value={month.saved_amount}
                    className="font-button-text text-button-text text-tertiary font-semibold"
                  />
                </li>
              ))}
            </ul>
          )}
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
                description="Your savings will be listed here once they are recorded."
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

/** What this member has saved since the first of the month. */
function ThisMonthCard({
  member,
  months,
}: {
  member: MemberFinancialsRow | null;
  months: SavingsScheduleRow[];
}) {
  const current = months[0] ?? null;
  const saved = toNumber(member?.savings_this_month);

  return (
    <div className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-col justify-between rounded-xl border p-5">
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-body-lg text-body-lg text-on-surface font-semibold">
            {current ? current.cycle : 'This month'}
          </h3>
          <Icon name="savings" className="text-outline" />
        </div>
        <Money
          value={saved}
          className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface"
        />
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">
          {saved > 0
            ? `Saved so far this month${
                current ? ` across ${depositCount(toNumber(current.deposits))}` : ''
              }.`
            : 'Nothing saved yet this month. Nothing is owed.'}
        </p>
      </div>
      <p className="font-label-md text-label-md text-on-surface-variant mt-3 normal-case">
        {member?.last_saved_on
          ? `Last saved ${formatDate(member.last_saved_on)}.`
          : 'No savings recorded yet.'}
      </p>
    </div>
  );
}

/** Shares held, at the SACCO's one price. */
function SharesCard({
  member,
  sharePrice,
}: {
  member: MemberFinancialsRow | null;
  sharePrice: number | null;
}) {
  const owned = toNumber(member?.share_count);

  return (
    <div className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-col justify-between rounded-xl border p-5">
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-body-lg text-body-lg text-on-surface font-semibold">Shares</h3>
          <Icon name="pie_chart" className="text-outline" />
        </div>
        <Money
          value={member?.share_value}
          className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface"
        />
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">
          {shareCount(owned)} held
          {sharePrice ? ` · ${formatUGX(sharePrice)} per share` : ''}
        </p>
      </div>
      <Link
        href="/shares/buy"
        className="text-primary font-button-text text-button-text mt-3 flex items-center gap-1 hover:underline"
      >
        Buy shares
        <Icon name="chevron_right" size={18} />
      </Link>
    </div>
  );
}

function DepositCard({ deposit }: { deposit: SavingsPaymentRow }) {
  return (
    <Link
      href={deposit.transaction_id ? `/transactions/${deposit.transaction_id}` : '/transactions'}
      className="bg-surface-container-lowest border-surface-container-high shadow-card hover:bg-surface-container-low flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors"
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
