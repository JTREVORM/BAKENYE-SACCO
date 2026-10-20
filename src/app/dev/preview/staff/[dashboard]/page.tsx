import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { StaffShell } from '@/components/layout/StaffShell';
import { DashboardHeader } from '@/components/staff/DashboardHeader';
import { AdminSaccoFigures, AdminSecurityActivity, AdminSecurityFigures } from '@/components/staff/AdministrationPanels';
import { CashierFigures, CashierReceiptsPanel } from '@/components/staff/CashierPanels';
import { LoanArrearsPanel, LoanPipelinePanel, LoanPortfolioFigures, LoansDuePanel } from '@/components/staff/LoanDeskPanels';
import { TransactionsPanel } from '@/components/staff/RecentTransactions';
import { ActivityPanel } from '@/components/staff/FinancialActivity';
import { AccountTypeCard, TotalFundsCard } from '@/components/finance/AccountCards';
import { IN_COLOUR, OUT_COLOUR, MoneyDistribution, PairedBars } from '@/components/finance/Charts';
import { LedgerTable } from '@/components/finance/LedgerTable';
import { CollectSearch } from '@/app/(staff)/staff/savings/collect/CollectSearch';
import { MemberCollectionPanel } from '@/components/collections/MemberCollectionPanel';
import { KpiCard, KpiCardFeature, Money, Panel, QuickAction, ViewAllLink } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { STAFF_NAV, can, visibleNav, type Access, type Permission } from '@/lib/rbac';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES } from '@/lib/treasury-format';
import { FIXTURE_COLLECTION_ACCOUNTS, FIXTURE_COLLECTION_VIEW, FIXTURE_LOAN_BALANCE, FIXTURE_MEMBERS, FIXTURE_MONTHLY_FLOW, FIXTURE_PORTFOLIO, FIXTURE_TRANSACTIONS } from '@/lib/fixtures';
import { toNumber } from '@/lib/money';
import type { AccountMovementRow } from '@/types/treasury';
import styles from '@/components/staff/StaffDashboard.module.css';

export const metadata: Metadata = { title: 'Staff dashboard review', robots: { index: false } };

const contexts = {
  administration: { roleName: 'Admin', role: 'admin', subtitle: 'Accounts, security and configuration', permissions: ['finance.view', 'users.manage', 'audit.view', 'settings.view', 'members.create'] },
  cashier: { roleName: 'Cashier / Teller', role: 'cashier', subtitle: 'The counter', permissions: ['finance.view', 'finance.record', 'savings.record', 'shares.sell'] },
  loans: { roleName: 'Loan Officer', role: 'loan_officer', subtitle: 'Applications, repayments and arrears', permissions: ['loans.view', 'loans.assess', 'reports.member'] },
  finance: { roleName: 'Accountant', role: 'accountant', subtitle: 'Cash at Merchant, Bank and Hand, and the books', permissions: ['finance.view', 'finance.record', 'finance.reconcile', 'reports.member'] },
  collections: { roleName: 'Field Officer', role: 'field_officer', subtitle: 'Find a member and record what they bring', permissions: ['savings.record'] },
} as const;

// These treasury and security values are the existing approved dashboard QA
// scenario. All other values below are adapted from src/lib/fixtures.ts.
const totals = { merchant: 485000, bank: 4145000, cash: 2100000, total: 6730000 };
const security = { staff_accounts: 4, member_logins: 56, must_change: 17, signins_24h: 8, failures_24h: 1, paused_now: 0, members_without_login: 0 };
const metrics = {
  total_members: FIXTURE_MEMBERS.filter(m => m.status === 'active').length,
  members_this_month: 0,
  total_savings: FIXTURE_MEMBERS.reduce((s, m) => s + toNumber(m.savings_balance), 0),
  savings_this_month: FIXTURE_MEMBERS.reduce((s, m) => s + toNumber(m.savings_this_month), 0),
  savers_this_month: FIXTURE_MEMBERS.filter(m => toNumber(m.savings_this_month) > 0).length,
  todays_collections: FIXTURE_TRANSACTIONS.filter(t => t.status === 'posted' && t.direction === 'debit').reduce((s, t) => s + toNumber(t.amount), 0),
  outstanding_loans: FIXTURE_LOAN_BALANCE.outstanding,
  active_loan_count: 1,
  pending_loans: FIXTURE_PORTFOLIO.filter(l => l.status === 'under_review' || l.status === 'applied').length,
};

/** Development-only review of real presentation components. Never queries or
 * writes the database; the production routes retain all access checks. */
export default async function StaffDashboardPreview({ params, searchParams }: {
  params: Promise<{ dashboard: string }>;
  searchParams: Promise<{ q?: string; member?: string; limited?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { dashboard } = await params;
  if (!Object.hasOwn(contexts, dashboard)) notFound();
  const context = contexts[dashboard as keyof typeof contexts];
  const sp = await searchParams;
  const requiredRead = dashboard === 'finance' ? ['finance.view'] : dashboard === 'loans' ? ['loans.view'] : [];
  const permissions = ['dashboard.staff', 'members.view', 'savings.view', 'transactions.view', ...requiredRead, ...(sp.limited ? [] : context.permissions)] as Permission[];
  const access: Access = { role: context.role, roleKind: 'staff', permissions };
  const user = { fullName: 'MWESIGWA TREVOR JOSEPH', roleName: context.roleName, role: context.role, photoUrl: null };
  const href = `/dev/preview/staff/${dashboard}`;
  const nav = visibleNav(access, STAFF_NAV).map(item => item.label === 'Dashboard' ? { ...item, href } : item);
  const actions = dashboard === 'cashier' ? [
    ...(can(access, 'savings.record') ? [{ href: '/staff/savings/collect', icon: 'point_of_sale', label: 'Collect savings', tone: 'primary' as const }] : []),
    ...(can(access, 'finance.record') ? [{ href: '/staff/finance/new/collection', icon: 'receipt_long', label: 'Record a payment', tone: 'success' as const }] : []),
    { href: '/staff/members', icon: 'person_search', label: 'Find a member', tone: 'neutral' as const },
    ...(can(access, 'shares.sell') ? [{ href: '/staff/shares/sell', icon: 'pie_chart', label: 'Sell shares', tone: 'accent' as const }] : []),
    ...(can(access, 'finance.view') ? [{ href: '/staff/finance/receipts', icon: 'receipt', label: 'Receipts', tone: 'neutral' as const }] : []),
  ] : dashboard === 'loans' ? [
    ...(can(access, 'loans.assess') ? [{ href: '/staff/members', icon: 'request_quote', label: 'New application', tone: 'primary' as const }] : []),
    { href: '/staff/loans', icon: 'payments', label: 'All loans', tone: 'neutral' as const },
    { href: '/staff/loans/products', icon: 'inventory_2', label: 'Loan products', tone: 'neutral' as const },
    ...(can(access, 'reports.member') ? [{ href: '/staff/reports', icon: 'summarize', label: 'Reports', tone: 'accent' as const }] : []),
  ] : [];
  const quickActions = <Panel title="Quick actions" icon="bolt"><div className="grid grid-cols-2 gap-2">{actions.map(a => <QuickAction key={a.href} {...a} />)}</div></Panel>;
  const names = new Map(FIXTURE_MEMBERS.map(m => [m.id, { full_name: m.full_name, member_no: m.member_no }]));

  return <div className={styles.workspace}>
    <StaffShell user={user} nav={nav} unreadCount={3}>
      <div data-staff-dashboard={dashboard} data-admin-dashboard={dashboard === 'administration' || undefined} className="space-y-gutter">
        <DashboardHeader roleName={context.roleName} fullName={user.fullName} subtitle={context.subtitle} />
        {dashboard === 'administration' ? <>
          {can(access, 'users.manage') || can(access, 'audit.view') ? <AdminSecurityFigures s={security} /> : null}
          {can(access, 'finance.view') ? <PreviewFunds /> : null}
          <div data-admin-panels className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2"><TransactionsPanel rows={FIXTURE_TRANSACTIONS} /></div>
            {can(access, 'finance.view') ? <div className="min-w-0"><ActivityPanel compact series={FIXTURE_MONTHLY_FLOW} months={6} baseHref={href} /></div> : null}
          </div>
          <AdminSaccoFigures m={metrics} />
          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">{can(access, 'audit.view') ? <AdminSecurityActivity rows={[]} /> : <Panel title="Security activity" icon="policy"><EmptyState compact icon="lock" title="Needs the audit permission" description="Sign-in activity is part of the audit log." /></Panel>}</div>
            <Panel title="Administration" icon="tune"><div className="grid grid-cols-2 gap-2">
              {can(access, 'users.manage') ? <QuickAction href="/staff/users" icon="manage_accounts" label="Staff accounts" /> : null}
              {can(access, 'members.create') ? <QuickAction href="/staff/members/new" icon="person_add" label="Register member" tone="success" /> : null}
              {can(access, 'settings.view') ? <><QuickAction href="/staff/settings?section=fees" icon="sell" label="Fees" tone="neutral" /><QuickAction href="/staff/settings" icon="settings" label="Settings" tone="neutral" /></> : null}
              {can(access, 'audit.view') ? <QuickAction href="/staff/audit" icon="policy" label="Audit log" tone="neutral" /> : null}
            </div></Panel>
          </div>
        </> : null}
        {dashboard === 'cashier' ? <>
          <CashierFigures m={metrics} />
          {can(access, 'finance.view') ? <PreviewFunds /> : null}
          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
            {quickActions}
            <div className="min-w-0 xl:col-span-2">{can(access, 'finance.view') ? <CashierReceiptsPanel rows={FIXTURE_TRANSACTIONS.filter(t => t.direction === 'debit').map(t => ({ id: t.id, receipt_no: t.reference, transaction_id: t.id, amount: t.amount, payer: t.member_name, category: t.description ?? '', receiving_account_name: FIXTURE_COLLECTION_ACCOUNTS[0].name, created_at: t.created_at, status: t.status }))} total={metrics.todays_collections} /> : <Panel title="Receipts you issued today" icon="receipt_long"><EmptyState compact icon="receipt_long" title="Receipts are part of the books" description="Your role does not include viewing finance." /></Panel>}</div>
          </div>
        </> : null}
        {dashboard === 'loans' ? <>
          <LoanPortfolioFigures pending={{ count: metrics.pending_loans }} live={[FIXTURE_LOAN_BALANCE]} outstanding={toNumber(FIXTURE_LOAN_BALANCE.outstanding)} overdue={[FIXTURE_LOAN_BALANCE]} overdueSum={toNumber(FIXTURE_LOAN_BALANCE.overdue_amount)} />
          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
            <div className="min-w-0 space-y-gutter xl:col-span-2">
              <LoanPipelinePanel rows={FIXTURE_PORTFOLIO.filter(l => l.status === 'under_review').map(l => ({ id: l.id, loan_no: l.loan_no, principal: toNumber(l.principal), status: l.status, applied_on: l.applied_on, member: { full_name: l.member_name, member_no: l.member_no } }))} />
              <LoanArrearsPanel rows={[FIXTURE_LOAN_BALANCE]} names={names} />
            </div>
            <div className="min-w-0 space-y-gutter">{quickActions}<LoansDuePanel rows={[]} names={names} /></div>
          </div>
        </> : null}
        {dashboard === 'finance' ? <FinancePreview canRecord={can(access, 'finance.record')} /> : null}
        {dashboard === 'collections' ? <div className="grid grid-cols-1 gap-gutter lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-4 lg:self-start"><CollectSearch query={sp.q ?? 'Nakabugo'} results={FIXTURE_MEMBERS} selectedId={sp.member ?? FIXTURE_MEMBERS[0].id} /></div>
          <div className="min-w-0"><MemberCollectionPanel view={FIXTURE_COLLECTION_VIEW} canRecord={can(access, 'savings.record')} accounts={FIXTURE_COLLECTION_ACCOUNTS} /></div>
        </div> : null}
      </div>
    </StaffShell>
  </div>;
}

function PreviewFunds({ compact = false }: { compact?: boolean }) {
  return <section aria-label="SACCO funds" className="grid grid-cols-2 gap-3 sm:gap-gutter lg:grid-cols-4">
    <KpiCardFeature icon="wallet" label="Total SACCO funds" value={<Money value={totals.total} compact={compact} />} footnote="As at 19 Oct 2026" href="/staff/finance" />
    {ACCOUNT_TYPES.map(t => <KpiCard key={t} icon={ACCOUNT_TYPE_META[t].icon} label={ACCOUNT_TYPE_META[t].label} value={<Money value={totals[t]} compact={compact} />} footnote="As at 19 Oct 2026" tone={t === 'merchant' ? 'accent' : t === 'bank' ? 'primary' : 'success'} href={ACCOUNT_TYPE_META[t].href} />)}
  </section>;
}

function FinancePreview({ canRecord }: { canRecord: boolean }) {
  const ledger: AccountMovementRow[] = FIXTURE_TRANSACTIONS.map((t, i) => ({
    entry_id: i, transaction_id: t.id, account_id: FIXTURE_COLLECTION_ACCOUNTS[0].id, account_code: FIXTURE_COLLECTION_ACCOUNTS[0].code, account_name: FIXTURE_COLLECTION_ACCOUNTS[0].name, account_type: 'cash', entry_date: t.occurred_on, money_in: t.direction === 'debit' ? toNumber(t.amount) : 0, money_out: t.direction === 'credit' ? toNumber(t.amount) : 0, balance_after: totals.cash, created_at: t.created_at, reference: t.reference, txn_type: t.type, txn_status: t.status, method: t.method, description: t.description, external_ref: null, member_id: t.member_id, member_no: t.member_no, member_name: t.member_name, recorded_by: null, recorded_by_name: t.recorded_by_name, reverses_id: t.reverses_id, reversed_by_id: t.reversed_by_id, counter_account_type: null, counter_account_name: null, movement_class: 'collection', category_label: t.description ?? '', running_balance: totals.cash, custom_expense: null,
  }));
  return <>
    <div className="flex flex-col gap-gutter">
      <div className="order-2 grid grid-cols-1 gap-gutter lg:order-1 lg:grid-cols-3">
        {ACCOUNT_TYPES.map(t => <AccountTypeCard key={t} type={t} balance={totals[t]} accounts={1} lines={(t === 'merchant' ? ["Today's collections", "Today's transfers to bank"] : t === 'bank' ? ["Today's deposits", "Today's withdrawals"] : ["Today's cash received", "Today's cash deposits", "Today's cash payments"]).map(label => ({ label, value: 0 }))} />)}
      </div>
      <div className="order-1 lg:order-2"><TotalFundsCard totals={totals} asOf="19 Oct 2026" /></div>
    </div>
    {canRecord ? <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <QuickAction href="/staff/finance/new/collection" icon="point_of_sale" label="Record Collection" tone="success" />
      <QuickAction href="/staff/finance/new/collection?preset=merchant" icon="smartphone" label="Merchant Collection" tone="accent" />
      <QuickAction href="/staff/finance/new/transfer?kind=merchant_to_bank" icon="swap_horiz" label="Transfer Merchant to Bank" />
      <QuickAction href="/staff/finance/new/transfer?kind=cash_to_bank" icon="local_atm" label="Deposit Cash to Bank" />
      <QuickAction href="/staff/finance/new/transfer?kind=bank_to_cash" icon="account_balance" label="Withdraw from Bank" tone="neutral" />
      <QuickAction href="/staff/finance/new/expense" icon="trending_down" label="Record Expense" tone="danger" />
      <QuickAction href="/staff/finance/new/payment" icon="request_quote" label="Record Payment" tone="danger" />
      <QuickAction href="/staff/finance/new/receipt" icon="call_received" label="Other Receipt" tone="success" />
    </section> : null}
    <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
      <div className="min-w-0 space-y-gutter xl:col-span-2">
        <Panel title="Today's activity" subtitle="19 Oct 2026" icon="today"><EmptyState compact icon="today" title="Nothing recorded today" description="Collections, transfers, deposits and payments recorded today will be listed here." /></Panel>
        <Panel title="Monthly cash flow" subtitle="Money received against money paid out, six months. Internal transfers are excluded." icon="insights"><PairedBars points={FIXTURE_MONTHLY_FLOW.map(p => ({ label: p.label, a: p.in, b: p.out }))} a={{ label: 'Money received', colour: IN_COLOUR }} b={{ label: 'Money paid out', colour: OUT_COLOUR }} emptyTitle="No money has moved yet" emptyBody="Money received and paid out will be charted month by month here." /></Panel>
        <section><div className="mb-3 flex items-end justify-between gap-3"><h2 className="text-title-md">Recent transactions</h2><ViewAllLink href="/staff/finance/ledger" /></div><LedgerTable rows={ledger} /></section>
      </div>
      <div className="min-w-0 space-y-gutter">
        <Panel title="Money distribution" subtitle="Where the funds are held right now" icon="donut_large"><MoneyDistribution slices={ACCOUNT_TYPES.map(t => ({ key: t, label: ACCOUNT_TYPE_META[t].label, value: totals[t], colour: ACCOUNT_TYPE_META[t].colour }))} /></Panel>
        <Panel title="Waiting for approval" icon="pending_actions"><EmptyState compact icon="task_alt" title="Nothing waiting" description="Transfers and payments that need approval appear here." /></Panel>
      </div>
    </div>
  </>;
}
