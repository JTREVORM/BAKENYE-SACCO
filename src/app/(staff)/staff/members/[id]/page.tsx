import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getActiveGroups, getMemberFinancials } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Avatar, Icon, Money, PageTitle } from '@/components/ui/primitives';
import { LoanStatusBadge, MemberStatusBadge, SavingsStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { TransactionRow } from '@/components/member/TransactionRow';
import { MemberStatusControl } from './MemberStatusControl';
import { SavingsPlanControl } from './SavingsPlanControl';
import { AssignGroupControl } from '@/components/groups/AssignGroupControl';
import { savingDayLabel } from '@/lib/groups';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type {
  LoanBalanceRow,
  SavingsPeriodRow,
  SavingsPlanRow,
  ShareLotRow,
  TransactionFeedRow,
} from '@/types/db';

export const metadata: Metadata = { title: 'Member' };

/**
 * Staff view of one member.
 *
 * The operational hub: identity, the three balances kept visibly separate,
 * the actions a cashier or officer actually needs, and the member's financial
 * history in one place.
 */
export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('members.view');
  const { id } = await params;

  const member = await getMemberFinancials(id);
  if (!member) notFound();

  const supabase = await createClient();
  const groups = can(user.role, 'groups.manage') ? await getActiveGroups() : [];
  const [loansRes, txnRes, sharesRes, weeklyRes, monthlyRes, plansRes] = await Promise.all([
    supabase.from('loan_balances').select('*').eq('member_id', id).order('disbursed_on', { ascending: false, nullsFirst: false }),
    supabase
      .from('transaction_feed')
      .select('*')
      .eq('member_id', id)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('share_lots').select('*').eq('member_id', id).order('purchased_on', { ascending: false }).limit(5),
    supabase.from('savings_periods').select('*').eq('member_id', id).eq('kind', 'weekly').order('period_start', { ascending: false }).limit(6),
    supabase.from('savings_periods').select('*').eq('member_id', id).eq('kind', 'monthly').order('period_start', { ascending: false }).limit(6),
    supabase.from('savings_plans').select('*').eq('member_id', id).is('active_to', null),
  ]);

  const loans = (loansRes.data ?? []) as LoanBalanceRow[];
  const transactions = (txnRes.data ?? []) as TransactionFeedRow[];
  const shares = (sharesRes.data ?? []) as ShareLotRow[];
  const weekly = (weeklyRes.data ?? []) as SavingsPeriodRow[];
  const monthly = (monthlyRes.data ?? []) as SavingsPeriodRow[];
  const plans = (plansRes.data ?? []) as SavingsPlanRow[];

  const weeklyPlan = plans.find((p) => p.kind === 'weekly');
  const monthlyPlan = plans.find((p) => p.kind === 'monthly');

  const actions = [
    can(user.role, 'savings.record') && {
      href: `/staff/savings/record?member=${id}`,
      icon: 'savings',
      label: 'Record savings',
      tone: 'bg-primary-container text-on-primary-container',
    },
    can(user.role, 'shares.sell') && {
      href: `/staff/shares/sell?member=${id}`,
      icon: 'pie_chart',
      label: 'Sell shares',
      tone: 'bg-secondary-container text-on-secondary-container',
    },
    can(user.role, 'cash.movement') && {
      href: `/staff/transactions/cash?member=${id}&type=deposit`,
      icon: 'add_circle',
      label: 'Deposit',
      tone: 'bg-tertiary-container text-white',
    },
    can(user.role, 'cash.movement') && {
      href: `/staff/transactions/cash?member=${id}&type=withdrawal`,
      icon: 'remove_circle',
      label: 'Withdraw',
      tone: 'bg-error-container text-error',
    },
    can(user.role, 'loans.assess') && {
      href: `/staff/loans/new?member=${id}`,
      icon: 'request_quote',
      label: 'New loan',
      tone: 'bg-surface-container-high text-on-surface-variant',
    },
    {
      href: `/staff/members/${id}/ledger`,
      icon: 'receipt_long',
      label: 'Ledger',
      tone: 'bg-surface-container-high text-on-surface-variant',
    },
    {
      href: `/staff/reports/statement?member=${id}`,
      icon: 'description',
      label: 'Statement',
      tone: 'bg-surface-container-high text-on-surface-variant',
    },
  ].filter(Boolean) as { href: string; icon: string; label: string; tone: string }[];

  return (
    <div className="space-y-6">
      <PageTitle
        title={member.full_name}
        subtitle={`${member.member_no} · member since ${formatDate(member.joined_on)}`}
        action={
          can(user.role, 'members.manage') ? (
            <Link
              href={`/staff/members/${id}/edit`}
              className="border-outline-variant bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg border px-4 font-semibold transition-colors"
            >
              <Icon name="edit" size={20} />
              Edit
            </Link>
          ) : undefined
        }
      />

      {/* Identity card */}
      <section className="bg-surface border-outline-variant/50 elev-1 flex flex-wrap items-start gap-4 rounded-xl border p-5">
        <Avatar name={member.full_name} src={member.photo_url} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">
              {member.full_name}
            </h2>
            <MemberStatusBadge status={member.status} />
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <Detail icon="badge" label="Member number" value={member.member_no} mono />
            <Detail icon="phone" label="Phone" value={formatPhone(member.phone)} />
            <Detail icon="mail" label="Email" value={member.email ?? '—'} />
            <Detail icon="assignment" label="National ID" value={member.national_id ?? '—'} />
            <Detail icon="work" label="Occupation" value={member.occupation ?? '—'} />
            <Detail icon="location_on" label="Address" value={member.address ?? '—'} />
            <Detail
              icon="handshake"
              label="Next of kin"
              value={
                member.next_of_kin_name
                  ? `${member.next_of_kin_name}${
                      member.next_of_kin_relation ? ` (${member.next_of_kin_relation})` : ''
                    }${member.next_of_kin_phone ? ` · ${formatPhone(member.next_of_kin_phone)}` : ''}`
                  : '—'
              }
            />
          </dl>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {can(user.role, 'groups.manage') ? (
            <AssignGroupControl
              memberId={id}
              memberName={member.full_name}
              currentGroupId={member.group_id}
              groups={groups}
            />
          ) : null}
          {can(user.role, 'members.status') ? (
            <MemberStatusControl memberId={id} status={member.status} name={member.full_name} />
          ) : null}
        </div>
      </section>

      {/* Group placement — this is what decides when they are collected from. */}
      <section
        className={clsx(
          'flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4',
          member.group_id
            ? 'bg-surface border-outline-variant/50'
            : 'bg-secondary-fixed text-on-secondary-fixed border-transparent',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={clsx(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              member.group_id
                ? 'bg-primary-fixed text-primary'
                : 'bg-white/40 text-on-secondary-fixed',
            )}
          >
            <Icon name="groups" size={24} />
          </span>
          <div className="min-w-0">
            <p className="text-label-md font-label-md text-on-surface-variant">Savings group</p>
            {member.group_id ? (
              <>
                <Link
                  href={`/staff/groups/${member.group_id}`}
                  className="text-body-lg font-body-lg text-primary block truncate font-semibold"
                >
                  {member.group_name}
                </Link>
                <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                  {member.group_code} · collects on {savingDayLabel(member.group_saving_day)}
                </p>
              </>
            ) : (
              <>
                <p className="text-body-lg font-body-lg font-semibold">Not in a group</p>
                <p className="text-label-md font-label-md normal-case">
                  This member appears on no collection sheet until they are placed in one.
                </p>
              </>
            )}
          </div>
        </div>

        {toNumber(member.savings_outstanding) > 0 ? (
          <div className="text-right">
            <p className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider">
              Savings arrears
            </p>
            <Money
              value={member.savings_outstanding}
              className="text-headline-lg-mobile font-headline-lg-mobile text-error"
            />
          </div>
        ) : null}
      </section>

      {/* The three balances, deliberately separate. */}
      <section className="gap-gutter grid grid-cols-1 sm:grid-cols-3">
        <BalanceCard
          label="Savings"
          value={member.savings_balance}
          detail={`In ${formatUGX(member.deposits_total + member.weekly_total + member.monthly_total)} · out ${formatUGX(member.withdrawals_total)}`}
          tone="primary"
        />
        <BalanceCard
          label="Share capital"
          value={member.share_value}
          detail={`${member.share_count} ${member.share_count === 1 ? 'share' : 'shares'}`}
          tone="secondary"
        />
        <BalanceCard
          label="Loan balance"
          value={member.loan_balance}
          detail={
            Number(member.overdue_amount) > 0
              ? `${formatUGX(member.overdue_amount)} overdue`
              : member.next_due_on
                ? `Next payment ${formatDate(member.next_due_on)}`
                : 'No active loan'
          }
          tone={Number(member.overdue_amount) > 0 ? 'error' : 'neutral'}
        />
      </section>

      {/* Quick actions */}
      {actions.length > 0 ? (
        <section>
          <h2 className="text-button-text font-button-text text-on-surface mb-3">Actions</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="bg-surface-container hover:bg-surface-container-highest flex h-24 flex-col items-center justify-center gap-2 rounded-lg p-2 text-center transition-colors"
              >
                <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full', a.tone)}>
                  <Icon name={a.icon} size={20} />
                </span>
                <span className="text-label-md font-label-md text-on-surface normal-case leading-tight">
                  {a.label}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Loans */}
        <Panel title="Loans" href={`/staff/loans?member=${id}`}>
          {loans.length === 0 ? (
            <EmptyState icon="payments" title="No loans" description="This member has never borrowed." />
          ) : (
            <ul className="divide-outline-variant/30 divide-y">
              {loans.map((l) => (
                <li key={l.loan_id}>
                  <Link
                    href={`/staff/loans/${l.loan_id}`}
                    className="hover:bg-surface-container-lowest flex items-center justify-between gap-3 p-4 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-body-md font-body-md text-primary tabular truncate font-semibold">
                        {l.loan_no}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                        {formatUGX(l.principal)} over {l.period_months} months
                      </p>
                      <div className="mt-1">
                        <LoanStatusBadge status={l.status} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money
                        value={l.outstanding}
                        className={clsx(
                          'text-body-md font-body-md font-bold',
                          toNumber(l.outstanding) > 0 ? 'text-error' : 'text-tertiary',
                        )}
                      />
                      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                        {Math.round(toNumber(l.percent_repaid))}% repaid
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Savings targets and periods */}
        <Panel
          title="Savings"
          action={
            can(user.role, 'savings.record') ? (
              <SavingsPlanControl
                memberId={id}
                weeklyTarget={weeklyPlan ? Number(weeklyPlan.target_amount) : null}
                monthlyTarget={monthlyPlan ? Number(monthlyPlan.target_amount) : null}
              />
            ) : undefined
          }
        >
          <div className="border-outline-variant/30 grid grid-cols-2 divide-x divide-outline-variant/30 border-b">
            <TargetCell label="Weekly target" value={weeklyPlan?.target_amount} />
            <TargetCell label="Monthly target" value={monthlyPlan?.target_amount} />
          </div>

          {weekly.length === 0 && monthly.length === 0 ? (
            <EmptyState
              icon="savings"
              title="No savings periods yet"
              description="Periods open automatically once a target is set and a payment is recorded."
            />
          ) : (
            <ul className="divide-outline-variant/30 divide-y">
              {[...weekly, ...monthly]
                .sort((a, b) => b.period_start.localeCompare(a.period_start))
                .slice(0, 8)
                .map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-body-md font-body-md text-on-surface truncate font-semibold">
                        {p.period_label}
                      </p>
                      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                        {p.kind === 'weekly' ? 'Weekly' : 'Monthly'} ·{' '}
                        {formatUGX(p.paid_amount)} of {formatUGX(p.expected_amount)}
                      </p>
                    </div>
                    <SavingsStatusBadge status={p.status} />
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        {/* Shares */}
        <Panel title="Share purchases" href={`/staff/shares?member=${id}`}>
          {shares.length === 0 ? (
            <EmptyState
              icon="pie_chart"
              title="No shares"
              description="This member has not bought any shares."
            />
          ) : (
            <ul className="divide-outline-variant/30 divide-y">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-body-md font-body-md text-on-surface font-semibold">
                      {s.quantity} {s.quantity === 1 ? 'share' : 'shares'}
                    </p>
                    <p className="text-label-md font-label-md text-on-surface-variant normal-case">
                      {formatDate(s.purchased_on)} at {formatUGX(s.unit_price)} each
                    </p>
                  </div>
                  <Money
                    value={s.total_value}
                    className="text-body-md font-body-md text-on-surface font-semibold"
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Transactions */}
        <Panel title="Recent transactions" href={`/staff/transactions?q=${member.member_no}`}>
          {transactions.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title="No transactions"
              description="Nothing has been recorded for this member yet."
            />
          ) : (
            <div className="flex flex-col gap-2 p-4">
              {transactions.map((t) => (
                <TransactionRow key={t.id} txn={t} href={`/staff/transactions/${t.id}`} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Detail({
  icon,
  label,
  value,
  mono,
}: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon name={icon} size={18} className="text-on-surface-variant mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-label-md font-label-md text-on-surface-variant">{label}</dt>
        <dd
          className={clsx(
            'text-body-md font-body-md text-on-surface break-words',
            mono && 'tabular font-mono',
          )}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function BalanceCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: unknown;
  detail: string;
  tone: 'primary' | 'secondary' | 'error' | 'neutral';
}) {
  const styles = {
    primary: 'bg-primary text-on-primary',
    secondary: 'bg-secondary-container text-on-secondary-container',
    error: 'bg-error-container text-on-error-container',
    neutral: 'bg-surface-container-high text-on-surface border border-surface-container-highest',
  }[tone];

  return (
    <div className={clsx('elev-1 relative overflow-hidden rounded-xl p-5', styles)}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
      <p className="text-label-md font-label-md relative z-10 uppercase tracking-wider opacity-80">
        {label}
      </p>
      <Money value={value} className="text-display-currency font-display-currency relative z-10 mt-1 block" />
      <p className="text-body-md font-body-md relative z-10 mt-1 opacity-80">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  href,
  action,
  children,
}: {
  title: string;
  href?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border-outline-variant/30 elev-1 overflow-hidden rounded-xl border">
      <div className="border-outline-variant/30 bg-surface-bright flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">{title}</h2>
        {action ??
          (href ? (
            <Link href={href} className="text-primary text-label-md font-label-md hover:underline">
              View all
            </Link>
          ) : null)}
      </div>
      {children}
    </section>
  );
}

function TargetCell({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="p-4">
      <p className="text-label-md font-label-md text-on-surface-variant">{label}</p>
      {value ? (
        <Money value={value} className="text-body-lg font-body-lg text-on-surface font-semibold" />
      ) : (
        <p className="text-body-md font-body-md text-on-surface-variant/70">Not set</p>
      )}
    </div>
  );
}
