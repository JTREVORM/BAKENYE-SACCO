import Link from 'next/link';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getMemberFinancials, getMemberSchedules, getUnreadCount } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { MemberShell } from '@/components/layout/MemberShell';
import { Badge, Icon, Money, ProgressBar } from '@/components/ui/primitives';
import { SavingsStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import {
  SAVINGS_FREQUENCY_EVERY,
  categoryTier,
} from '@/lib/categories';
import { formatDate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { formatUGX, percent, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { MemberFinancialsRow, SavingsPaymentRow, SavingsScheduleRow } from '@/types/db';

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
 * promise, so that slot now shows the current cycle's contribution status
 * instead — same position, same treatment, a number we can actually stand behind.
 *
 * What the member is expected to save comes from their savings category, not
 * from anything hard-coded here: a Silver Saver sees UGX 5,000 a week and a
 * Diamond Saver sees UGX 100,000 a month because that is what the SACCO set.
 */
export default async function SavingsPage() {
  const user = await requireMember();
  const [m, unread, schedules] = await Promise.all([
    getMemberFinancials(user.memberId),
    getUnreadCount(),
    getMemberSchedules(user.memberId, 6),
  ]);

  const supabase = await createClient();
  const { data: deposits } = await supabase
    .from('savings_payments')
    .select('id, amount, paid_on, method, period_id, transaction_id')
    .eq('member_id', user.memberId)
    .order('paid_on', { ascending: false })
    .limit(8);

  // The cycle the member is currently being judged against: the earliest that
  // is still open, falling back to the most recent one if everything is settled.
  const current =
    schedules.find((s) => s.status === 'pending' || s.status === 'partial') ??
    schedules[0] ??
    null;

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

        {/* The member's savings category: what they agreed to save, how often,
          and when the next one falls due. A member who does not know what is
          expected of them cannot meet it. */}
        <SavingsCategoryCard member={m} />

        {/* Bento pair: this cycle, and progress towards the share category. */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CurrentCycleCard schedule={current} member={m} />
          <ShareProgressCard member={m} />
        </section>

        {/* Recent cycles — expected, paid and what is still owed on each. */}
        <section>
          <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-4">
            Recent Cycles
          </h3>
          {schedules.length === 0 ? (
            <div className="bg-surface-container-lowest border-surface-container-high rounded-xl border">
              <EmptyState
                icon="calendar_month"
                title="No savings cycles yet"
                description={
                  m?.savings_category_id
                    ? 'Your first cycle will appear here once it opens.'
                    : 'A savings category has not been set for you yet, so nothing is expected.'
                }
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {schedules.map((sch) => (
                <li
                  key={sch.schedule_id}
                  className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
                >
                  <div className="min-w-0">
                    <p className="font-body-lg text-body-lg text-on-surface truncate font-semibold">
                      {sch.cycle}
                    </p>
                    <p className="font-label-md text-label-md text-on-surface-variant normal-case">
                      Due {formatDate(sch.due_on)} · Expected{' '}
                      {formatUGX(sch.expected_amount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <Money
                        value={sch.paid_amount}
                        className="font-button-text text-button-text text-on-surface font-semibold"
                      />
                      {toNumber(sch.outstanding) > 0 ? (
                        <p className="font-label-md text-label-md text-error normal-case">
                          {formatUGX(sch.outstanding)} to go
                        </p>
                      ) : null}
                    </div>
                    <SavingsStatusBadge status={sch.status} />
                  </div>
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

/**
 * The savings category, stated plainly.
 *
 * With no category set, this says so rather than showing a zero target: nobody
 * has agreed an amount with this member, and printing "UGX 0 a month" would
 * read as though somebody had.
 */
function SavingsCategoryCard({ member }: { member: MemberFinancialsRow | null }) {
  if (!member?.savings_category_id || !member.savings_frequency) {
    return (
      <section className="bg-surface-container-lowest border-surface-container-high shadow-card flex items-center gap-3 rounded-xl border p-5">
        <span className="bg-surface-container-high text-on-surface-variant flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <Icon name="savings" size={24} />
        </span>
        <div className="min-w-0">
          <p className="font-label-md text-label-md text-on-surface-variant">
            Savings category
          </p>
          <p className="font-body-lg text-body-lg text-on-surface font-semibold">
            Not set yet
          </p>
          <p className="font-label-md text-label-md text-on-surface-variant normal-case">
            Speak to the SACCO office to choose how much you save and how often.
          </p>
        </div>
      </section>
    );
  }

  const tier = categoryTier(member.savings_category_code);
  const behind = toNumber(member.savings_outstanding) > 0;

  return (
    <section className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-primary-fixed text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-full">
          <Icon name={tier.icon} size={24} />
        </span>
        <div className="min-w-0">
          <p className="font-label-md text-label-md text-on-surface-variant">
            Savings category
          </p>
          <p className="font-body-lg text-body-lg text-on-surface truncate font-semibold">
            {member.savings_category_name}
          </p>
          <p className="font-label-md text-label-md text-on-surface-variant normal-case">
            {formatUGX(member.savings_expected_amount)}{' '}
            {SAVINGS_FREQUENCY_EVERY[member.savings_frequency]}
            {member.savings_next_due_on
              ? ` · next due ${formatDate(member.savings_next_due_on)}`
              : ''}
          </p>
        </div>
      </div>

      {behind ? (
        <div className="text-right">
          <p className="font-label-md text-label-md text-on-surface-variant">Still owed</p>
          <Money
            value={member.savings_outstanding}
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
  );
}

/**
 * This cycle: expected, paid, outstanding.
 *
 * Green only when the cycle is actually settled — the Stitch card is always the
 * celebratory green, which would be actively misleading in a week the member
 * has missed.
 */
function CurrentCycleCard({
  schedule,
  member,
}: {
  schedule: SavingsScheduleRow | null;
  member: MemberFinancialsRow | null;
}) {
  const settled = schedule?.status === 'paid';

  return (
    <div
      className={clsx(
        'shadow-card flex flex-col justify-between rounded-xl p-5',
        settled
          ? 'bg-tertiary-container text-on-tertiary-container'
          : 'bg-surface-container-lowest border-surface-container-high border',
      )}
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3
            className={clsx(
              'font-body-lg text-body-lg font-semibold',
              settled ? 'text-white' : 'text-on-surface',
            )}
          >
            {schedule ? schedule.cycle : 'This cycle'}
          </h3>
          <Icon
            name={settled ? 'check_circle' : 'schedule'}
            className={settled ? 'text-white' : 'text-outline'}
          />
        </div>

        {schedule ? (
          <div className="font-body-md text-body-md mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1">
            <span className={settled ? 'text-white opacity-80' : 'text-on-surface-variant'}>
              Paid:{' '}
              <strong className={settled ? 'text-white' : 'text-on-surface'}>
                {formatUGX(schedule.paid_amount)}
              </strong>
            </span>
            <span className={settled ? 'text-white opacity-80' : 'text-on-surface-variant'}>
              Expected: {formatUGX(schedule.expected_amount)}
            </span>
          </div>
        ) : (
          <p className="font-body-md text-body-md text-on-surface-variant mb-2">
            {member?.savings_category_id
              ? 'No cycle is open yet. Your next one will appear here.'
              : 'A savings category has not been set for you yet.'}
          </p>
        )}
      </div>

      {schedule ? (
        <div>
          <ProgressBar
            value={percent(schedule.paid_amount, schedule.expected_amount)}
            label="Savings cycle progress"
            className="mb-1 h-2.5"
            tone={settled ? 'tertiary' : 'primary'}
          />
          <p
            className={clsx(
              'font-label-md text-label-md text-right normal-case',
              settled ? 'text-white opacity-90' : 'text-primary',
            )}
          >
            {settled
              ? 'Settled in full'
              : `${formatUGX(schedule.outstanding)} to go · due ${formatDate(schedule.due_on)}`}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Progress towards the share category — section 12 of the brief, member side.
 *
 * The deadline is this member's own: their joining date plus the qualification
 * window their category carries.
 */
function ShareProgressCard({ member }: { member: MemberFinancialsRow | null }) {
  if (!member?.share_category_id || !member.share_target_shares) {
    return (
      <div className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-col justify-center rounded-xl border p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-body-lg text-body-lg text-on-surface font-semibold">Shares</h3>
          <Icon name="pie_chart" className="text-outline" />
        </div>
        <Money
          value={member?.share_value}
          className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface"
        />
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">
          {member?.share_count ?? 0} {member?.share_count === 1 ? 'share' : 'shares'} held. No
          share category has been set for you yet.
        </p>
      </div>
    );
  }

  const pct = toNumber(member.share_progress_percent);
  const tier = categoryTier(member.share_category_code);

  return (
    <div className="bg-surface-container-lowest border-surface-container-high shadow-card flex flex-col justify-between rounded-xl border p-5">
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-body-lg text-body-lg text-on-surface font-semibold">
            {member.share_category_name} Shares
          </h3>
          {member.share_qualified ? (
            <Badge tone="success" dot>
              Qualified
            </Badge>
          ) : member.share_qualification_lapsed ? (
            <Badge tone="error" dot>
              Deadline passed
            </Badge>
          ) : (
            <Badge tone={tier.tone}>{Math.round(pct)}%</Badge>
          )}
        </div>

        <div className="font-body-md text-body-md mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1">
          <span className="text-on-surface-variant">
            Held:{' '}
            <strong className="text-on-surface">
              {member.share_count} of {member.share_target_shares}
            </strong>
          </span>
          <span className="text-on-surface-variant">
            {formatUGX(member.share_value)} of {formatUGX(member.share_target_amount)}
          </span>
        </div>
      </div>

      <div>
        <ProgressBar
          value={pct}
          label="Share category progress"
          className="mb-1 h-2.5"
          tone={
            member.share_qualified
              ? 'tertiary'
              : member.share_qualification_lapsed
                ? 'error'
                : 'primary'
          }
        />
        <p
          className={clsx(
            'font-label-md text-label-md text-right normal-case',
            member.share_qualification_lapsed ? 'text-error' : 'text-primary',
          )}
        >
          {member.share_qualified
            ? 'Target reached'
            : `${member.share_shares_remaining ?? 0} shares to go${
                member.share_qualifies_by
                  ? ` · by ${formatDate(member.share_qualifies_by)}`
                  : ''
              }`}
        </p>
      </div>
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
