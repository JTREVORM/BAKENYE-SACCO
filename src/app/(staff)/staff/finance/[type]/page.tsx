import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can, canAny, type Role } from '@/lib/rbac';
import {
  getAccounts,
  getCashBankReport,
  getMonthlyFlow,
  getStaffUsers,
  getTreasurySummary,
  isIsoDate,
  LEDGER_PAGE_SIZE,
  queryLedger,
} from '@/lib/treasury';
import { Badge, Icon, PageTitle, Panel } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PanelSkeleton, TableSkeleton } from '@/components/ui/states';
import { AccountTypeCard } from '@/components/finance/AccountCards';
import { TypeStatement } from '@/components/finance/CashBankSections';
import { PairedBars } from '@/components/finance/Charts';
import { LedgerTable } from '@/components/finance/LedgerTable';
import { LedgerFilters } from '@/components/finance/LedgerFilters';
import { Pager } from '@/components/finance/Pager';
import { PeriodPicker } from '@/components/finance/PeriodPicker';
import { ACCOUNT_TYPE_META, dayFigures, isAccountType, maskAccountNumber } from '@/lib/treasury-format';
import { formatDate, monthStart, toISODate } from '@/lib/format';
import { formatUGX } from '@/lib/money';
import type { FinanceAccountType } from '@/types/treasury';

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const { type } = await params;
  return { title: isAccountType(type) ? ACCOUNT_TYPE_META[type].label : 'Finance' };
}

type SP = { from?: string; to?: string; account?: string; kind?: string; user?: string; q?: string; page?: string };

/**
 * Cash at Merchant, Cash at Bank or Cash at Hand: the balance, the day, each
 * account of that kind, a statement for any period, and the ledger.
 */
export default async function AccountTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<SP>;
}) {
  const { type } = await params;
  if (!isAccountType(type)) notFound();
  const user = await requirePermission('finance.view');
  const sp = await searchParams;

  const today = toISODate();
  const from = isIsoDate(sp.from) ? sp.from : monthStart();
  const to = isIsoDate(sp.to) ? sp.to : today;
  const meta = ACCOUNT_TYPE_META[type];

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon={meta.icon}
        title={meta.label}
        subtitle={meta.subtitle}
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: meta.label }]}
        action={<TypeActions type={type} role={user.role} />}
      />

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <Suspense fallback={<PanelSkeleton height="h-64" />}>
          <Balance type={type} role={user.role} />
        </Suspense>
        <div className="xl:col-span-2">
          <Suspense fallback={<PanelSkeleton height="h-64" />}>
            <AccountList type={type} role={user.role} />
          </Suspense>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-title-md text-on-surface">Statement for a period</h2>
        <PeriodPicker from={from} to={to} />
        <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          <Suspense key={`${from}-${to}`} fallback={<PanelSkeleton height="h-72" />}>
            <Statement type={type} from={from} to={to} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton height="h-72" />}>
            <TypeChart type={type} />
          </Suspense>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-title-md text-on-surface">{meta.label} ledger</h2>
        <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={6} />}>
          <Ledger type={type} sp={sp} from={from} to={to} />
        </Suspense>
      </section>
    </div>
  );
}

function TypeActions({ type, role }: { type: FinanceAccountType; role: Role }) {
  const record = can(role, 'finance.record');
  const collect = canAny(role, 'finance.record', 'savings.record');
  const links: { href: string; label: string; icon: string; primary?: boolean; show: boolean }[] =
    type === 'merchant'
      ? [
          { href: '/staff/finance/new/collection?preset=merchant', label: 'Record merchant collection', icon: 'add', primary: true, show: collect },
          { href: '/staff/finance/new/transfer?kind=merchant_to_bank', label: 'Transfer to bank', icon: 'swap_horiz', show: record },
        ]
      : type === 'bank'
        ? [
            { href: '/staff/finance/new/transfer?kind=bank_to_cash', label: 'Withdraw from bank', icon: 'account_balance', primary: true, show: record },
            { href: '/staff/finance/new/transfer?kind=bank_to_bank', label: 'Bank to bank', icon: 'sync_alt', show: record },
            { href: '/staff/finance/new/payment', label: 'Record payment', icon: 'request_quote', show: record },
          ]
        : [
            { href: '/staff/finance/new/collection', label: 'Record collection', icon: 'add', primary: true, show: collect },
            { href: '/staff/finance/new/transfer?kind=cash_to_bank', label: 'Deposit to bank', icon: 'local_atm', show: record },
            { href: '/staff/finance/new/expense', label: 'Record expense', icon: 'trending_down', show: record },
          ];

  return (
    <>
      {links
        .filter((l) => l.show)
        .map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              l.primary
                ? 'inline-flex h-touch-target-min items-center gap-2 rounded-full bg-ink px-5 text-button-text font-semibold text-white shadow-neu-dark transition-colors hover:bg-ink-soft'
                : 'inline-flex h-touch-target-min items-center gap-2 rounded-full bg-surface px-5 text-button-text font-semibold text-on-surface shadow-neu transition-shadow hover:shadow-card-hover'
            }
          >
            <Icon name={l.icon} size={18} />
            {l.label}
          </Link>
        ))}
    </>
  );
}

async function Balance({ type, role }: { type: FinanceAccountType; role: Role }) {
  const s = await getTreasurySummary();
  if (!s) return <ErrorState title="Unable to load the balance" />;
  const f = dayFigures(s.movements);
  const accounts = s.accounts.filter((a) => a.account_type === type && a.status !== 'closed').length;
  const lines =
    type === 'merchant'
      ? [
          { label: "Today's collections", value: f.merchant.collections, tone: 'in' as const },
          { label: "Today's transfers to bank", value: f.merchant.toBank, tone: 'move' as const },
          { label: "Today's payments", value: f.merchant.payments, tone: 'out' as const },
        ]
      : type === 'bank'
        ? [
            { label: "Today's deposits", value: f.bank.deposits, tone: 'in' as const },
            { label: "Today's bank receipts", value: f.bank.receipts, tone: 'in' as const },
            { label: "Today's withdrawals", value: f.bank.withdrawals, tone: 'move' as const },
            { label: "Today's bank payments", value: f.bank.payments, tone: 'out' as const },
          ]
        : [
            { label: "Today's cash received", value: f.cash.received, tone: 'in' as const },
            { label: "Today's cash deposits", value: f.cash.toBank, tone: 'move' as const },
            { label: "Today's cash payments", value: f.cash.payments, tone: 'out' as const },
          ];

  return (
    <AccountTypeCard
      type={type}
      balance={s.totals[type]}
      accounts={accounts}
      lines={lines}
      setupHref={can(role, 'finance.accounts') ? '/staff/finance/accounts' : undefined}
    />
  );
}

async function AccountList({ type, role }: { type: FinanceAccountType; role: Role }) {
  const accounts = await getAccounts({ type });
  const meta = ACCOUNT_TYPE_META[type];
  if (!accounts) return <ErrorState title="Unable to load the accounts" />;

  return (
    <Panel
      title={`${meta.short} accounts`}
      subtitle={accounts.length === 0 ? undefined : 'Balances from the ledger'}
      icon={meta.icon}
      padded={false}
      action={
        can(role, 'finance.accounts') ? (
          <Link href="/staff/finance/accounts" className="inline-flex h-9 items-center gap-1 rounded-full bg-surface px-3.5 text-label-md font-semibold text-primary shadow-neu-sm hover:shadow-card">
            Manage
            <Icon name="chevron_right" size={15} />
          </Link>
        ) : undefined
      }
    >
      {accounts.length === 0 ? (
        <EmptyState
          compact
          icon={meta.icon}
          title={`No ${meta.noun} yet`}
          description={`Once a ${meta.noun} is set up, its balance and details appear here.`}
        />
      ) : (
        <ul className="divide-y divide-outline-variant/70">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`?account=${a.id}#ledger`} className="text-body-md font-semibold text-on-surface hover:text-primary hover:underline">
                    {a.name}
                  </Link>
                  {a.is_default ? <Badge tone="info">Default</Badge> : null}
                  {a.status !== 'active' ? <Badge tone="neutral">{a.status}</Badge> : null}
                </div>
                <p className="tabular text-label-md font-normal text-on-surface-variant">
                  {a.code}
                  {type === 'merchant' ? ` · ${a.provider ?? ''}${a.merchant_code ? ` · code ${a.merchant_code}` : ''}` : ''}
                  {type === 'bank' ? ` · ${a.bank_name ?? ''} · ${maskAccountNumber(a.account_number)}${a.branch ? ` · ${a.branch}` : ''}` : ''}
                </p>
                <p className="text-label-md font-normal text-on-surface-variant">
                  {a.last_reconciled_on
                    ? `Reconciled ${formatDate(a.last_reconciled_on)}${Number(a.last_variance) !== 0 ? ` · variance ${formatUGX(a.last_variance)}` : ''}`
                    : 'Never reconciled'}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-button-text font-bold text-on-surface">{formatUGX(a.balance)}</p>
                {can(role, 'finance.reconcile') && a.status !== 'closed' ? (
                  <Link href={`/staff/finance/reconciliation/new?account=${a.id}`} className="text-label-md font-semibold text-primary hover:underline">
                    Reconcile
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function Statement({ type, from, to }: { type: FinanceAccountType; from: string; to: string }) {
  const report = await getCashBankReport(from, to);
  if (!report) return <ErrorState title="Unable to load the statement" />;
  return <TypeStatement report={report} type={type} />;
}

async function TypeChart({ type }: { type: FinanceAccountType }) {
  const flow = await getMonthlyFlow(6);
  if (!flow) return <ErrorState title="Unable to load the chart" />;
  const merchant = ACCOUNT_TYPE_META.merchant.colour;
  const bank = ACCOUNT_TYPE_META.bank.colour;
  const cash = ACCOUNT_TYPE_META.cash.colour;

  return (
    <Panel
      title={type === 'merchant' ? 'Merchant movement' : type === 'bank' ? 'Bank movement' : 'Cash movement'}
      subtitle="Six months"
      icon="bar_chart"
    >
      {type === 'merchant' ? (
        <PairedBars
          points={flow.map((p) => ({ label: p.label, a: p.merchant_collections, b: p.merchant_to_bank }))}
          a={{ label: 'Collections', colour: merchant }}
          b={{ label: 'Moved to bank', colour: bank }}
          emptyTitle="No merchant movement yet"
          emptyBody="Merchant collections and transfers to the bank will appear here."
        />
      ) : type === 'bank' ? (
        <PairedBars
          points={flow.map((p) => ({ label: p.label, a: p.bank_in, b: p.bank_to_cash }))}
          a={{ label: 'Into the bank', colour: bank }}
          b={{ label: 'Withdrawn to cash', colour: cash }}
          emptyTitle="No bank movement yet"
          emptyBody="Deposits and withdrawals will appear here once recorded."
        />
      ) : (
        <PairedBars
          points={flow.map((p) => ({ label: p.label, a: p.bank_to_cash, b: 0 }))}
          a={{ label: 'Withdrawn from the bank', colour: cash }}
          b={{ label: 'Not charted', colour: '#dce2ee' }}
          emptyTitle="No cash withdrawals yet"
          emptyBody="Cash drawn from the bank will be charted here. Use the statement for cash collections and payments."
        />
      )}
    </Panel>
  );
}

async function Ledger({ type, sp, from, to }: { type: FinanceAccountType; sp: SP; from: string; to: string }) {
  const page = Math.max(1, Number(sp.page) || 1);
  const [accounts, users] = await Promise.all([getAccounts({ type }), getStaffUsers()]);
  let result;
  try {
    result = await queryLedger({
      type,
      account: sp.account,
      kind: sp.kind,
      user: sp.user,
      q: sp.q,
      from,
      to,
      page,
    });
  } catch {
    return <ErrorState title="Unable to load the ledger" />;
  }

  return (
    <div id="ledger">
      <LedgerFilters accounts={(accounts ?? []).map((a) => ({ id: a.id, name: a.name }))} users={users} />
      <LedgerTable
        rows={result.rows}
        emptyTitle={`No ${ACCOUNT_TYPE_META[type].label.toLowerCase()} transactions in this period`}
        emptyBody="Try a wider period, or clear the filters. Entries appear here as soon as they are recorded."
      />
      <Pager page={page} total={result.total} pageSize={LEDGER_PAGE_SIZE} />
    </div>
  );
}
