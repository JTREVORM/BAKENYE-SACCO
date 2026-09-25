import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getMemberFinancials, getShareProgress, getShareUnitPrice } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Avatar, Badge, Icon, Money, PageTitle } from '@/components/ui/primitives';
import { LoanStatusBadge, MemberStatusBadge } from '@/components/ui/status';
import { EmptyState } from '@/components/ui/states';
import { TransactionRow } from '@/components/member/TransactionRow';
import { MemberStatusControl } from './MemberStatusControl';
import { MemberAccountPanel } from '@/components/accounts/MemberAccountPanel';
import { MemberFeeActions } from '@/components/fees/MemberFeeActions';
import {
  getCollectionAccounts,
  getFees,
  getMemberFees,
  getMemberProfileChanges,
} from '@/lib/access-queries';
import { formatDateTime, MEMBER_STATUS_HINTS } from '@/lib/format';
import type { MemberFeeRow, MemberProfileChangeRow } from '@/types/access';
import type { AuditLogRow } from '@/types/db';
import { shareCount } from '@/lib/savings';
import { formatDate, formatPhone } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type {
  LoanBalanceRow,
  MemberFinancialsRow,
  MemberShareProgressRow,
  SavingsPeriodRow,
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
  const mayCollect = can(user, 'fees.collect');
  const [memberFees, profileChanges, allFees, accounts, auditRes] = await Promise.all([
    getMemberFees(id),
    getMemberProfileChanges(id),
    mayCollect ? getFees() : Promise.resolve([]),
    mayCollect ? getCollectionAccounts() : Promise.resolve([]),
    // Status and category changes, from the audit log. RLS returns nothing to
    // someone without the audit permission, and the panel says so.
    supabase
      .from('audit_logs')
      .select('*')
      .eq('record_id', id)
      .in('module', ['Members', 'Categories'])
      .not('action', 'in', '("member.profile_updated","member.phone_changed","member.name_changed")')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  const unpaidFees = memberFees.filter((f) => f.status === 'unpaid');
  const owedMandatory = unpaidFees
    .filter((f) => f.is_mandatory && f.charged_at_registration)
    .reduce((sum, f) => sum + Number(f.amount), 0);
  const chargeable = allFees
    .filter((f) => f.status === 'active' && f.applies_to_existing_members)
    .map((f) => ({ id: f.id, name: f.name, amount: Number(f.amount) }));
  const statusEvents = (auditRes.data ?? []) as AuditLogRow[];
  const canSeeHistory = can(user, 'members.manage') || can(user, 'audit.view');
  const [shareProgress, sharePrice] = await Promise.all([
    getShareProgress(id),
    getShareUnitPrice(),
  ]);
  const [loansRes, txnRes, sharesRes, weeklyRes, monthlyRes] = await Promise.all([
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
  ]);

  const loans = (loansRes.data ?? []) as LoanBalanceRow[];
  const transactions = (txnRes.data ?? []) as TransactionFeedRow[];
  const shares = (sharesRes.data ?? []) as ShareLotRow[];
  const weekly = (weeklyRes.data ?? []) as SavingsPeriodRow[];
  const monthly = (monthlyRes.data ?? []) as SavingsPeriodRow[];

  const actions = [
    can(user, 'savings.record') && {
      href: `/staff/savings/record?member=${id}`,
      icon: 'savings',
      label: 'Record savings',
      tone: 'bg-primary-container text-on-primary-container',
    },
    can(user, 'shares.sell') && {
      href: `/staff/shares/sell?member=${id}`,
      icon: 'pie_chart',
      label: 'Sell shares',
      tone: 'bg-secondary-container text-on-secondary-container',
    },
    can(user, 'cash.movement') && {
      href: `/staff/transactions/cash?member=${id}&type=deposit`,
      icon: 'add_circle',
      label: 'Deposit',
      tone: 'bg-tertiary-container text-white',
    },
    can(user, 'cash.movement') && {
      href: `/staff/transactions/cash?member=${id}&type=withdrawal`,
      icon: 'remove_circle',
      label: 'Withdraw',
      tone: 'bg-error-container text-error',
    },
    can(user, 'loans.assess') && {
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
          can(user, 'members.manage') ? (
            <Link
              href={`/staff/members/${id}/edit`}
              className="bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors shadow-neu-sm"
            >
              <Icon name="edit" size={20} />
              Edit Member
            </Link>
          ) : undefined
        }
      />

      {member.status === 'pending' ? (
        <div className="bg-primary-fixed text-on-primary-fixed-variant flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Icon name="pending_actions" size={22} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-button-text">Pending - not yet an active member</p>
              <p className="text-body-md">
                {owedMandatory > 0
                  ? `${formatUGX(owedMandatory)} in mandatory registration fees is unpaid. The member becomes active as soon as it is paid or waived.`
                  : MEMBER_STATUS_HINTS.pending}
              </p>
            </div>
          </div>
          <a href="#fees" className="text-primary bg-surface h-touch-target-min inline-flex items-center rounded-full px-4 font-semibold shadow-neu-sm">
            Go to fees
          </a>
        </div>
      ) : null}

      {/* Identity card */}
      <section className="bg-surface shadow-card flex flex-wrap items-start gap-4 rounded-xl p-5">
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
          {can(user, 'members.status') ? (
            <MemberStatusControl memberId={id} status={member.status} name={member.full_name} />
          ) : null}
        </div>
      </section>

      <MemberAccountPanel
        member={{
          id: member.id,
          member_no: member.member_no,
          phone: member.phone,
          full_name: member.full_name,
          status: member.status,
          user_id: member.user_id,
        }}
        viewer={user}
      />

      {/* Categories — what this member is expected to buy, and to save.
        Both are read from the member's own row, so a blank one says so rather
        than being filled in with a plausible default. */}
      <section className="gap-gutter grid grid-cols-1 lg:grid-cols-2">
        <SavingsSummaryPanel member={member} />
        <SharesSummaryPanel progress={shareProgress} sharePrice={sharePrice} />
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
            <ul className="divide-outline-variant/70 divide-y">
              {loans.map((l) => (
                <li key={l.loan_id}>
                  <Link
                    href={`/staff/loans/${l.loan_id}`}
                    className="hover:bg-surface-container-low flex items-center justify-between gap-3 p-4 transition-colors"
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

        {/* Savings, month by month. There is no target, so there is nothing to
            set here and nothing to fall short of. */}
        <Panel title="Savings">
          <div className="border-outline-variant grid grid-cols-2 divide-x divide-outline-variant/70 border-b">
            <Figure label="Total savings" value={member.savings_balance} />
            <Figure label="Saved this month" value={member.savings_this_month} tone="text-tertiary" />
          </div>

          {weekly.length === 0 && monthly.length === 0 ? (
            <EmptyState
              icon="savings"
              title="No savings yet"
              description="Months appear here as savings are recorded. Savings are open — nothing is expected."
            />
          ) : (
            <ul className="divide-outline-variant/70 divide-y">
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
                        {toNumber(p.paid_amount) > 0 ? 'Saved' : 'Nothing saved'}
                      </p>
                    </div>
                    <Money
                      value={p.paid_amount}
                      className="text-body-md font-body-md text-tertiary shrink-0 font-semibold"
                    />
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
            <ul className="divide-outline-variant/70 divide-y">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FeesPanel
          fees={memberFees}
          actions={
            mayCollect || can(user, 'fees.manage') ? (
              <MemberFeeActions
                memberId={id}
                unpaid={unpaidFees}
                chargeable={chargeable}
                accounts={accounts}
                canCollect={mayCollect}
                canWaive={can(user, 'fees.manage')}
              />
            ) : null
          }
        />
        <HistoryPanel changes={profileChanges} events={statusEvents} canSee={canSeeHistory} />
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
    <div className={clsx('shadow-card relative overflow-hidden rounded-xl p-5', styles)}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
      <p className="text-label-md font-label-md relative z-10 opacity-80">
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
    <section className="bg-surface shadow-card overflow-hidden rounded-xl">
      <div className="border-outline-variant bg-surface flex items-center justify-between gap-3 border-b p-4">
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

/* ------------------------------------------------------------------------ */

/**
 * How this member is saving.
 *
 * Savings are open: there is no target, nothing outstanding and no next due
 * date, so none of those appear. What a member of staff is actually asked at
 * the counter is how much the member holds and how much they have put in this
 * month, and that is what this says.
 */
function SavingsSummaryPanel({ member }: { member: MemberFinancialsRow }) {
  return (
    <div className="bg-surface border-outline-variant shadow-card flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
            <Icon name="savings" size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-label-md font-label-md text-on-surface-variant">Savings</p>
            <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
              Open — any amount, any time
            </p>
          </div>
        </div>
        <Badge tone="info">No target</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Total savings" value={member.savings_balance} />
        <Figure label="This month" value={member.savings_this_month} tone="text-tertiary" />
        <div className="min-w-0">
          <dt className="text-label-md font-label-md text-on-surface-variant truncate">
            Last saved
          </dt>
          <dd className="text-body-md font-body-md text-on-surface truncate font-semibold">
            {member.last_saved_on ? formatDate(member.last_saved_on) : '—'}
          </dd>
        </div>
      </dl>

      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
        A month without a deposit is not arrears and carries no penalty.
      </p>
    </div>
  );
}

/**
 * What this member holds in shares, at the SACCO's one price.
 *
 * There is no tier, no required number and no qualification deadline: a member
 * may buy any whole number of shares whenever they like.
 */
function SharesSummaryPanel({
  progress,
  sharePrice,
}: {
  progress: MemberShareProgressRow | null;
  sharePrice: number | null;
}) {
  const owned = toNumber(progress?.shares_owned);
  const price = progress?.share_price ?? sharePrice;

  return (
    <div className="bg-surface border-outline-variant shadow-card flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary-fixed text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
            <Icon name="pie_chart" size={22} />
          </span>
          <div className="min-w-0">
            <p className="text-label-md font-label-md text-on-surface-variant">Shares</p>
            <p className="text-body-lg font-body-lg text-on-surface truncate font-semibold">
              {shareCount(owned)}
            </p>
          </div>
        </div>
        <Badge tone="neutral">{price ? `${formatUGX(price)} each` : 'Price not set'}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Total share value" value={progress?.share_value} tone="text-tertiary" />
        <Figure label="Price per share" value={price} />
        <div className="min-w-0">
          <dt className="text-label-md font-label-md text-on-surface-variant truncate">
            Last purchase
          </dt>
          <dd className="text-body-md font-body-md text-on-surface truncate font-semibold">
            {progress?.last_purchase_on ? formatDate(progress.last_purchase_on) : '—'}
          </dd>
        </div>
      </dl>

      <p className="text-label-md font-label-md text-on-surface-variant normal-case">
        Any whole number of shares may be bought. There is no category and no ceiling.
      </p>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md font-label-md text-on-surface-variant truncate">{label}</dt>
      <dd
        className={clsx(
          'text-body-md font-body-md truncate font-semibold',
          tone ?? 'text-on-surface',
        )}
      >
        <Money value={value} />
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const FEE_STATUS_TONE = { unpaid: 'warning', paid: 'success', waived: 'neutral' } as const;

/** What this member has been charged, and what became of each charge. */
function FeesPanel({
  fees,
  actions,
}: {
  fees: MemberFeeRow[];
  actions: React.ReactNode;
}) {
  const owed = fees.filter((f) => f.status === 'unpaid').reduce((s, f) => s + Number(f.amount), 0);
  return (
    <section id="fees" className="bg-surface shadow-card scroll-mt-24 overflow-hidden rounded-xl">
      <div className="border-outline-variant flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-button-text font-button-text text-on-surface font-bold">Fees</h2>
          <p className="text-label-md text-on-surface-variant font-normal">
            {fees.length === 0 ? 'Nothing charged.' : owed > 0 ? `${formatUGX(owed)} owed` : 'Nothing owed.'}
          </p>
        </div>
      </div>
      {fees.length === 0 ? (
        <EmptyState compact icon="receipt" title="No fees charged" description="Registration fees and any fee charged later appear here." />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {fees.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-body-md text-on-surface truncate font-semibold">{f.fee_name}</p>
                <p className="text-label-md text-on-surface-variant font-normal normal-case">
                  {f.charged_at_registration ? 'At registration' : f.charge_reason ?? 'Charged'} · {formatDate(f.charged_on)}
                  {f.status === 'paid' && f.paid_on ? ` · paid ${formatDate(f.paid_on)}` : ''}
                  {f.status === 'waived' && f.waived_reason ? ` · waived: ${f.waived_reason}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money value={f.amount} className="text-body-md text-on-surface font-semibold" />
                {f.status === 'paid' && f.paid_transaction_id ? (
                  <Link href={`/staff/transactions/${f.paid_transaction_id}`} className="text-primary text-label-md hover:underline">
                    Receipt
                  </Link>
                ) : (
                  <Badge tone={FEE_STATUS_TONE[f.status]}>{f.status === 'unpaid' ? 'Unpaid' : 'Waived'}</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {actions ? <div className="border-outline-variant border-t p-4">{actions}</div> : null}
    </section>
  );
}

/**
 * Who changed this member's record, what it was before, and why - field by
 * field - together with status and category changes from the audit log.
 */
function HistoryPanel({
  changes,
  events,
  canSee,
}: {
  changes: MemberProfileChangeRow[];
  events: AuditLogRow[];
  canSee: boolean;
}) {
  type Entry = { at: string; key: string; title: string; detail: string | null; who: string | null; reason: string | null };
  const entries: Entry[] = [
    ...changes.map((c) => ({
      at: c.changed_at,
      key: `c${c.id}`,
      title: `${c.field_label} changed`,
      detail: `${c.old_value ?? '—'} → ${c.new_value ?? '—'}`,
      who: c.changed_by_name,
      reason: c.reason,
    })),
    ...events.map((e) => ({
      at: e.created_at,
      key: `a${e.id}`,
      title: e.summary ?? e.action,
      detail: null,
      who: e.actor_name,
      reason: e.reason,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="bg-surface shadow-card overflow-hidden rounded-xl">
      <div className="border-outline-variant border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">History</h2>
        <p className="text-label-md text-on-surface-variant font-normal">Changes to this member’s official record.</p>
      </div>
      {!canSee ? (
        <p className="text-body-md text-on-surface-variant p-4">
          The change history is visible to staff who edit member records or read the audit log.
        </p>
      ) : entries.length === 0 ? (
        <EmptyState compact icon="history" title="No changes recorded" description="Every edit to this member’s record will be listed here, with who made it and why." />
      ) : (
        <ol className="divide-outline-variant/70 divide-y">
          {entries.map((e) => (
            <li key={e.key} className="p-4">
              <p className="text-body-md text-on-surface font-semibold">{e.title}</p>
              {e.detail ? <p className="text-body-md text-on-surface-variant tabular break-words">{e.detail}</p> : null}
              <p className="text-label-md text-on-surface-variant mt-1 font-normal normal-case">
                {e.who ?? 'System'} · {formatDateTime(e.at)}
              </p>
              {e.reason ? (
                <p className="text-label-md text-on-surface-variant mt-0.5 font-normal italic normal-case">Reason: {e.reason}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
