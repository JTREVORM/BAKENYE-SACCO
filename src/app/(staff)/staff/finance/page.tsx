import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission, type SessionUser } from '@/lib/auth';
import { can, canAny, type Access } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/server';
import { getMonthlyFlow, getTreasurySummary, queryLedger } from '@/lib/treasury';
import { Icon, PageTitle, Panel, QuickAction, ViewAllLink } from '@/components/ui/primitives';
import { EmptyState, ErrorState, ListSkeleton, PanelSkeleton, Skeleton } from '@/components/ui/states';
import { AccountTypeCard, TotalFundsCard } from '@/components/finance/AccountCards';
import { ActivityList } from '@/components/finance/ActivityList';
import { IN_COLOUR, MoneyDistribution, OUT_COLOUR, PairedBars } from '@/components/finance/Charts';
import { LedgerLink, LedgerTable } from '@/components/finance/LedgerTable';
import { DocStatusBadge } from '@/components/finance/DocStatusBadge';
import { ApprovalControls } from '@/components/finance/ApprovalControls';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES, activityLines, dayFigures, TRANSFER_KIND_META } from '@/lib/treasury-format';
import { formatDate, toISODate } from '@/lib/format';
import { formatUGX, toNumber } from '@/lib/money';
import { clsx } from '@/lib/clsx';
import type { IconName } from '@/lib/icons';
import type { PaymentRegisterRow, TransferRegisterRow, TreasurySummary } from '@/types/treasury';

export const metadata: Metadata = { title: 'Finance' };

/**
 * The finance dashboard - where the SACCO's money is.
 *
 * Three cards, one per place money is held, and the total of the three; the
 * day's movements; what is waiting on somebody; and the trends. Every figure
 * comes from `treasury_summary()` or the account ledger. Nothing on the page
 * is typed in, estimated or carried over from a mockup: an account with no
 * entries shows UGX 0, and a kind of account that has not been set up says so.
 */
export default async function FinanceOverview({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; approval?: string }>;
}) {
  const sp = await searchParams;

  // The cashbook used to live here behind ?tab=. Old links still land on it.
  if (sp.tab) {
    const q = new URLSearchParams();
    if (sp.from) q.set('from', sp.from);
    if (sp.to) q.set('to', sp.to);
    if (sp.approval) q.set('approval', sp.approval);
    q.set('tab', sp.tab);
    redirect(`/staff/finance/income-expenses?${q.toString()}`);
  }

  const user = await requirePermission('finance.view');

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="account_balance"
        title="Finance"
        subtitle="Where the SACCO's money is right now. Every figure is computed from the ledger."
        breadcrumb={[{ label: 'Staff', href: '/staff' }, { label: 'Finance' }]}
      />

      <Suspense fallback={<PositionSkeleton />}>
        <Position role={user} />
      </Suspense>

      <QuickActions role={user} />

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <div className="min-w-0 space-y-gutter xl:col-span-2">
          <Suspense fallback={<PanelSkeleton height="h-72" />}>
            <TodayPanel />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height="h-64" />}>
            <FlowPanels />
          </Suspense>
          <Suspense fallback={<ListSkeleton rows={5} />}>
            <RecentPanel />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-gutter">
          <Suspense fallback={<PanelSkeleton height="h-56" />}>
            <DistributionPanel />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height="h-56" />}>
            <PendingPanel user={user} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Position: alerts, the three cards and the total
 * ------------------------------------------------------------------------ */

async function Position({ role }: { role: Access }) {
  const s = await getTreasurySummary();
  if (!s) {
    return (
      <ErrorState
        title="Unable to load the account balances"
        description="Please refresh the page. If this continues, contact your administrator."
      />
    );
  }

  const f = dayFigures(s.movements);
  const count = (t: string) => s.accounts.filter((a) => a.account_type === t && a.status !== 'closed').length;
  const setupHref = can(role, 'finance.accounts') ? '/staff/finance/accounts' : undefined;

  return (
    <>
      <Alerts summary={s} role={role} />

      {/* On a phone the total comes first - the one number a manager opens the
          app for - and the three cards follow. From `lg` the cards lead, as the
          brief lays them out, with the total beneath them. */}
      <div className="flex flex-col gap-gutter">
        <div className="order-2 grid grid-cols-1 gap-gutter lg:order-1 lg:grid-cols-3">
          <AccountTypeCard
            type="merchant"
            balance={s.totals.merchant}
            accounts={count('merchant')}
            setupHref={setupHref}
            lines={[
              { label: "Today's collections", value: f.merchant.collections, tone: 'in' },
              { label: "Today's transfers to bank", value: f.merchant.toBank, tone: 'move' },
              ...(f.merchant.payments ? [{ label: "Today's payments", value: f.merchant.payments, tone: 'out' as const }] : []),
            ]}
          />
          <AccountTypeCard
            type="bank"
            balance={s.totals.bank}
            accounts={count('bank')}
            setupHref={setupHref}
            lines={[
              { label: "Today's deposits", value: f.bank.deposits + f.bank.receipts, tone: 'in' },
              { label: "Today's withdrawals", value: f.bank.withdrawals, tone: 'move' },
              ...(f.bank.payments ? [{ label: "Today's bank payments", value: f.bank.payments, tone: 'out' as const }] : []),
            ]}
          />
          <AccountTypeCard
            type="cash"
            balance={s.totals.cash}
            accounts={count('cash')}
            setupHref={setupHref}
            lines={[
              { label: "Today's cash received", value: f.cash.received, tone: 'in' },
              { label: "Today's cash deposits", value: f.cash.toBank, tone: 'move' },
              { label: "Today's cash payments", value: f.cash.payments, tone: 'out' },
            ]}
          />
        </div>
        <div className="order-1 lg:order-2">
          <TotalFundsCard totals={s.totals} asOf={formatDate(s.as_of)} />
        </div>
      </div>
    </>
  );
}

function PositionSkeleton() {
  return (
    <div className="flex flex-col gap-gutter" role="status">
      <span className="sr-only">Loading balances…</span>
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl bg-surface p-5 shadow-neu">
            <Skeleton className="h-11 w-44" />
            <Skeleton className="mt-6 h-3 w-24" />
            <Skeleton className="mt-2 h-8 w-40" />
            <Skeleton className="mt-5 h-3 w-full" />
            <Skeleton className="mt-3 h-3 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-44 w-full rounded-2xl" />
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Alerts - only real conditions, and thresholds only where the SACCO set one
 * ------------------------------------------------------------------------ */

type AlertItem = { key: string; tone: 'error' | 'warning' | 'info'; icon: IconName; title: string; detail: string; href: string };

function Alerts({ summary: s, role }: { summary: TreasurySummary; role: Access }) {
  const items: AlertItem[] = [];
  const t = s.thresholds;

  if (t.merchant_balance_alert > 0 && toNumber(s.totals.merchant) > t.merchant_balance_alert) {
    items.push({
      key: 'merchant-high', tone: 'warning', icon: 'smartphone',
      title: `Cash at Merchant is ${formatUGX(s.totals.merchant)}`,
      detail: `above the ${formatUGX(t.merchant_balance_alert)} limit - consider moving it to the bank`,
      href: '/staff/finance/new/transfer?kind=merchant_to_bank',
    });
  }
  if (t.cash_balance_alert > 0 && toNumber(s.totals.cash) > t.cash_balance_alert) {
    items.push({
      key: 'cash-high', tone: 'warning', icon: 'payments',
      title: `Cash at Hand is ${formatUGX(s.totals.cash)}`,
      detail: `above the ${formatUGX(t.cash_balance_alert)} limit - consider a deposit`,
      href: '/staff/finance/new/transfer?kind=cash_to_bank',
    });
  }
  for (const a of s.accounts.filter((x) => toNumber(x.balance) < 0)) {
    items.push({
      key: `negative-${a.id}`, tone: 'error', icon: 'error',
      title: `${a.name} is below zero`, detail: formatUGX(a.balance), href: ACCOUNT_TYPE_META[a.account_type].href,
    });
  }
  const waiting = s.pending.transfers + s.pending.payments + s.pending.expenses;
  if (waiting > 0) {
    items.push({
      key: 'pending', tone: 'warning', icon: 'pending_actions',
      title: `${waiting} ${waiting === 1 ? 'entry awaits' : 'entries await'} approval`,
      detail: formatUGX(toNumber(s.pending.transfers_amount) + toNumber(s.pending.payments_amount) + toNumber(s.pending.expenses_amount)),
      href: s.pending.transfers > 0 ? '/staff/finance/transfers?status=submitted' : '/staff/finance/payments?status=submitted',
    });
  }
  if (s.pending.deposits > 0) {
    items.push({
      key: 'deposits', tone: 'info', icon: 'account_balance',
      title: `${s.pending.deposits} pending ${s.pending.deposits === 1 ? 'deposit' : 'deposits'} to the bank`,
      detail: formatUGX(s.pending.deposits_amount), href: '/staff/finance/transfers?status=open',
    });
  }
  for (const w of s.large_withdrawals) {
    items.push({
      key: `wd-${w.id}`, tone: 'warning', icon: 'account_balance',
      title: `Large bank withdrawal ${w.transfer_no}`,
      detail: `${formatUGX(w.amount)} · ${w.status === 'completed' ? formatDate(w.transfer_date) : 'awaiting approval'}`,
      href: '/staff/finance/transfers?kind=bank_to_cash',
    });
  }
  for (const v of s.variances) {
    items.push({
      key: `var-${v.id}`, tone: 'error', icon: 'balance',
      title: `${v.name}: variance of ${formatUGX(v.variance)}`,
      detail: `at the reconciliation on ${formatDate(v.last_reconciled_on)}`, href: '/staff/finance/reconciliation',
    });
  }
  for (const u of s.unreconciled) {
    items.push({
      key: `unrec-${u.id}`, tone: 'info', icon: 'fact_check',
      title: `${u.name} ${u.last_reconciled_on ? 'is due for reconciliation' : 'has never been reconciled'}`,
      detail: u.last_reconciled_on ? `last on ${formatDate(u.last_reconciled_on)}` : 'compare it with the real balance',
      href: `/staff/finance/reconciliation/new?account=${u.id}`,
    });
  }
  if (s.reversals_this_month > 0) {
    items.push({
      key: 'reversals', tone: 'info', icon: 'undo',
      title: `${s.reversals_this_month} ${s.reversals_this_month === 1 ? 'reversal' : 'reversals'} this month`,
      detail: 'corrections posted to the ledger', href: '/staff/finance/ledger?kind=reversal',
    });
  }

  const thresholdsOff = t.merchant_balance_alert === 0 && t.cash_balance_alert === 0 && t.large_withdrawal_alert === 0;

  if (items.length === 0 && !thresholdsOff) return null;

  return (
    <section aria-label="Needs attention" className="flex flex-col gap-2.5">
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2.5">
          {items.slice(0, 8).map((i) => (
            <Link
              key={i.key}
              href={i.href}
              className={clsx(
                'card-interactive flex min-h-touch-target-min min-w-0 max-w-full items-center gap-2.5 rounded-xl border px-4 py-2.5',
                i.tone === 'error'
                  ? 'border-error/25 bg-error-container/60 text-on-error-container'
                  : i.tone === 'warning'
                    ? 'border-warning/25 bg-warning-container/70 text-on-warning-container'
                    : 'border-primary/15 bg-primary-fixed text-on-primary-fixed-variant',
              )}
            >
              <Icon name={i.icon} size={18} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-button-text leading-tight">{i.title}</span>
                <span className="block text-label-md font-normal opacity-80">{i.detail}</span>
              </span>
              <Icon name="chevron_right" size={17} className="shrink-0 opacity-70" />
            </Link>
          ))}
        </div>
      ) : null}
      {thresholdsOff && can(role, 'settings.manage') ? (
        <p className="flex items-center gap-1.5 text-label-md font-normal text-on-surface-variant">
          <Icon name="info" size={15} />
          Balance and withdrawal warnings are off.{' '}
          <Link href="/staff/settings?section=treasury" className="font-semibold text-primary underline">
            Set thresholds under Settings → Cash &amp; Bank
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * Quick actions
 * ------------------------------------------------------------------------ */

function QuickActions({ role }: { role: Access }) {
  const record = can(role, 'finance.record');
  const collect = canAny(role, 'finance.record', 'savings.record');
  const actions: { href: string; icon: IconName; label: string; tone: 'primary' | 'success' | 'accent' | 'danger' | 'neutral'; show: boolean }[] = [
    { href: '/staff/finance/new/collection', icon: 'point_of_sale', label: 'Record Collection', tone: 'success', show: collect },
    { href: '/staff/finance/new/collection?preset=merchant', icon: 'smartphone', label: 'Merchant Collection', tone: 'accent', show: collect },
    { href: '/staff/finance/new/transfer?kind=merchant_to_bank', icon: 'swap_horiz', label: 'Transfer Merchant to Bank', tone: 'primary', show: record },
    { href: '/staff/finance/new/transfer?kind=cash_to_bank', icon: 'local_atm', label: 'Deposit Cash to Bank', tone: 'primary', show: record },
    { href: '/staff/finance/new/transfer?kind=bank_to_cash', icon: 'account_balance', label: 'Withdraw from Bank', tone: 'neutral', show: record },
    { href: '/staff/finance/new/expense', icon: 'trending_down', label: 'Record Expense', tone: 'danger', show: record },
    { href: '/staff/finance/new/payment', icon: 'request_quote', label: 'Record Payment', tone: 'danger', show: record },
    { href: '/staff/finance/new/receipt', icon: 'call_received', label: 'Other Receipt', tone: 'success', show: record },
  ];
  const visible = actions.filter((a) => a.show);
  if (visible.length === 0) return null;

  return (
    <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {visible.map((a) => (
        <QuickAction key={a.href} href={a.href} icon={a.icon} label={a.label} tone={a.tone} />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * Today
 * ------------------------------------------------------------------------ */

async function TodayPanel() {
  const s = await getTreasurySummary();
  if (!s) return null;
  const lines = activityLines(s.movements);
  const any = s.movements.length > 0;

  return (
    <Panel
      title="Today's activity"
      subtitle={formatDate(s.as_of)}
      icon="today"
      padded={false}
      action={<LedgerLink href={`/staff/finance/ledger?from=${s.as_of}&to=${s.as_of}`} label="Today's ledger" />}
    >
      {any ? (
        <ActivityList lines={lines} />
      ) : (
        <EmptyState
          compact
          icon="today"
          title="Nothing recorded today"
          description="Collections, transfers, deposits and payments recorded today will be listed here."
        />
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Trends
 * ------------------------------------------------------------------------ */

async function FlowPanels() {
  const flow = await getMonthlyFlow(6);
  if (!flow) {
    return <ErrorState title="Unable to load the cash-flow charts" />;
  }

  return (
    <>
      <Panel title="Monthly cash flow" subtitle="Money received against money paid out, six months. Internal transfers are excluded." icon="insights">
        <PairedBars
          points={flow.map((p) => ({ label: p.label, a: p.money_in, b: p.money_out }))}
          a={{ label: 'Money received', colour: IN_COLOUR }}
          b={{ label: 'Money paid out', colour: OUT_COLOUR }}
          emptyTitle="No money has moved yet"
          emptyBody="Money received and paid out will be charted month by month here."
        />
      </Panel>
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
        <Panel title="Merchant movement" subtitle="Collections against transfers to the bank" icon="smartphone">
          <PairedBars
            points={flow.map((p) => ({ label: p.label, a: p.merchant_collections, b: p.merchant_to_bank }))}
            a={{ label: 'Collections', colour: ACCOUNT_TYPE_META.merchant.colour }}
            b={{ label: 'Moved to bank', colour: ACCOUNT_TYPE_META.bank.colour }}
            emptyTitle="No merchant movement yet"
            emptyBody="Merchant collections and transfers to the bank will appear here."
          />
        </Panel>
        <Panel title="Bank movement" subtitle="Money into the bank against withdrawals to cash" icon="account_balance">
          <PairedBars
            points={flow.map((p) => ({ label: p.label, a: p.bank_in, b: p.bank_to_cash }))}
            a={{ label: 'Into the bank', colour: ACCOUNT_TYPE_META.bank.colour }}
            b={{ label: 'Withdrawn to cash', colour: ACCOUNT_TYPE_META.cash.colour }}
            emptyTitle="No bank movement yet"
            emptyBody="Deposits and withdrawals will appear here once recorded."
          />
        </Panel>
      </div>
    </>
  );
}

async function DistributionPanel() {
  const s = await getTreasurySummary();
  if (!s) return null;
  return (
    <Panel title="Money distribution" subtitle="Where the funds are held right now" icon="donut_large">
      <MoneyDistribution
        slices={ACCOUNT_TYPES.map((t) => ({
          key: t,
          label: ACCOUNT_TYPE_META[t].label,
          value: s.totals[t],
          colour: ACCOUNT_TYPE_META[t].colour,
        }))}
      />
    </Panel>
  );
}

async function RecentPanel() {
  let rows;
  try {
    rows = (await queryLedger({ pageSize: 8 })).rows;
  } catch {
    return <ErrorState title="Unable to load recent transactions" />;
  }
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-title-md text-on-surface">Recent transactions</h2>
          <p className="text-label-md font-normal text-on-surface-variant">Every account entry, newest first</p>
        </div>
        <ViewAllLink href="/staff/finance/ledger" />
      </div>
      <LedgerTable rows={rows} />
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * Waiting on somebody
 * ------------------------------------------------------------------------ */

async function PendingPanel({ user }: { user: SessionUser }) {
  const supabase = await createClient();
  const [{ data: transfers }, { data: payments }] = await Promise.all([
    supabase
      .from('transfer_register')
      .select('*')
      .in('status', ['submitted', 'draft'])
      .order('created_at', { ascending: true })
      .limit(6),
    supabase
      .from('payment_register')
      .select('*')
      .in('status', ['submitted', 'draft'])
      .order('created_at', { ascending: true })
      .limit(6),
  ]);

  const items = [
    ...((transfers ?? []) as TransferRegisterRow[]).map((t) => ({
      key: `t-${t.id}`,
      kind: 'transfer' as const,
      id: t.id,
      number: t.transfer_no,
      title: `${TRANSFER_KIND_META[t.kind].label} · ${formatUGX(t.amount)}`,
      detail: `${t.source_account_name} → ${t.destination_account_name} · by ${t.created_by_name ?? 'staff'}`,
      amount: toNumber(t.amount),
      status: t.status,
      createdBy: t.created_by,
    })),
    ...((payments ?? []) as PaymentRegisterRow[]).map((p) => ({
      key: `p-${p.id}`,
      kind: p.source,
      id: p.id,
      number: p.payment_no ?? '',
      title: `${p.is_expense ? 'Expense' : 'Payment'} · ${formatUGX(p.amount)}`,
      detail: `${p.category}${p.payee ? ` · ${p.payee}` : ''} · by ${p.created_by_name ?? 'staff'}`,
      amount: toNumber(p.amount),
      status: p.status,
      createdBy: p.created_by,
    })),
  ];

  const canApprove = can(user, 'finance.approve');

  return (
    <Panel
      title="Waiting for approval"
      icon="pending_actions"
      padded={false}
      action={<ViewAllLink href="/staff/finance/transfers?status=open">All</ViewAllLink>}
    >
      {items.length === 0 ? (
        <EmptyState compact icon="task_alt" title="Nothing waiting" description="Transfers and payments that need approval appear here." />
      ) : (
        <ul className="divide-y divide-outline-variant/70">
          {items.map((i) => (
            <li key={i.key} className="space-y-2.5 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-md font-semibold text-on-surface">{i.title}</p>
                  <p className="tabular text-label-md font-normal text-on-surface-variant">{i.number}</p>
                  <p className="text-label-md font-normal text-on-surface-variant">{i.detail}</p>
                </div>
                <DocStatusBadge status={i.status} />
              </div>
              <ApprovalControls
                kind={i.kind}
                id={i.id}
                number={i.number}
                amount={i.amount}
                status={i.status}
                canApprove={canApprove}
                canCancel={i.createdBy === user.id || canApprove}
                canSubmit={i.createdBy === user.id || canApprove}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
