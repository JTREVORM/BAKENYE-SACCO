import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getAccounts, getCashBankReport, getReceiptsAndPayments, isIsoDate } from '@/lib/treasury';
import { DataTable, Icon, PageTitle, Panel, TabBar } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PanelSkeleton } from '@/components/ui/states';
import { ConsolidatedPosition, TypeStatement, statementFor } from '@/components/finance/CashBankSections';
import { LedgerTable } from '@/components/finance/LedgerTable';
import { PeriodPicker } from '@/components/finance/PeriodPicker';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { ACCOUNT_TYPE_META, ACCOUNT_TYPES, TRANSFER_KIND_META } from '@/lib/treasury-format';
import { formatDate, monthStart, toISODate } from '@/lib/format';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import type { AccountMovementRow } from '@/types/treasury';

export const metadata: Metadata = { title: 'Finance Reports' };

type View = 'cash-bank' | 'position' | 'receipts-payments' | 'statement';
type SP = { view?: string; from?: string; to?: string; account?: string };

const VIEWS: { id: View; label: string }[] = [
  { id: 'cash-bank', label: 'Cash & Bank' },
  { id: 'position', label: 'Cash position' },
  { id: 'receipts-payments', label: 'Receipts & Payments' },
  { id: 'statement', label: 'Account statement' },
];

/**
 * The finance reports. Each is a live read of the account ledger for the
 * chosen period, printable with the SACCO letterhead and exportable as CSV.
 */
export default async function FinanceReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.id === sp.view) ? (sp.view as View) : 'cash-bank';
  const from = isIsoDate(sp.from) ? sp.from : monthStart();
  const to = isIsoDate(sp.to) ? sp.to : toISODate();
  const q = (v: View) => `/staff/finance/reports?view=${v}&from=${from}&to=${to}${sp.account ? `&account=${sp.account}` : ''}`;

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="summarize"
        title="Finance Reports"
        subtitle="Cash & Bank, the cash position, receipts & payments and account statements - from the ledger."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Reports' }]}
      />
      <TabBar items={VIEWS.map((v) => ({ label: v.label, href: q(v.id), active: v.id === view }))} />
      <PeriodPicker from={from} to={to} />

      <Suspense key={`${view}-${from}-${to}-${sp.account ?? ''}`} fallback={<PanelSkeleton height="h-96" />}>
        {view === 'cash-bank' ? <CashBank from={from} to={to} by={user.fullName} /> : null}
        {view === 'position' ? <Position from={from} to={to} by={user.fullName} /> : null}
        {view === 'receipts-payments' ? <ReceiptsPayments from={from} to={to} by={user.fullName} /> : null}
        {view === 'statement' ? <Statement from={from} to={to} accountId={sp.account} by={user.fullName} /> : null}
      </Suspense>

      <MoreReports from={from} to={to} />
    </div>
  );
}

const period = (from: string, to: string) => `${formatDate(from)} – ${formatDate(to)}`;

async function CashBank({ from, to, by }: { from: string; to: string; by: string }) {
  const report = await getCashBankReport(from, to);
  if (!report) return <ErrorState title="Unable to load the Cash & Bank report" />;

  const csv: (string | number)[][] = [['Section', 'Line', 'Amount (UGX)']];
  for (const type of ACCOUNT_TYPES) {
    const s = statementFor(report, type);
    csv.push([ACCOUNT_TYPE_META[type].label, 'Opening balance', s.opening]);
    for (const l of s.lines) csv.push([ACCOUNT_TYPE_META[type].label, `${l.sign} ${l.label}`, l.amount]);
    csv.push([ACCOUNT_TYPE_META[type].label, 'Closing balance', s.closing]);
  }

  return (
    <div className="space-y-gutter">
      <PrintLetterhead title="Cash & Bank Report" meta={[{ label: 'Period', value: period(from, to) }]} generatedBy={by} />
      <div className="no-print flex justify-end">
        <ExportButtons rows={csv} filename="BUD-SACCO-cash-and-bank" documentTitle="BUD-SACCO Cash and Bank Report" />
      </div>
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        {ACCOUNT_TYPES.map((t) => (
          <TypeStatement key={t} report={report} type={t} />
        ))}
      </div>
      <section>
        <h2 className="mb-3 text-title-md text-on-surface">Consolidated cash position</h2>
        <ConsolidatedPosition report={report} />
      </section>
      <AccountBreakdown accounts={report.accounts} />
      <PrintFooter note="Every figure on this report is computed from the SACCO account ledger at the time of printing." />
    </div>
  );
}

function AccountBreakdown({ accounts }: { accounts: Awaited<ReturnType<typeof getCashBankReport>> extends infer R ? R extends { accounts: infer A } ? A : never : never }) {
  if (accounts.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-title-md text-on-surface">By account</h2>
      <DataTable dense head={<>
        <th>Account</th><th>Kind</th><th className="text-right">Opening</th><th className="text-right">Money in</th>
        <th className="text-right">Money out</th><th className="text-right">Closing</th>
      </>}>
        {accounts.map((a) => (
          <tr key={a.id}>
            <td className="whitespace-nowrap font-semibold">{a.name}</td>
            <td className="whitespace-nowrap">{ACCOUNT_TYPE_META[a.account_type].label}</td>
            <td className="tabular text-right">{formatAmount(a.opening)}</td>
            <td className="tabular text-right text-tertiary">{formatAmount(a.money_in)}</td>
            <td className="tabular text-right text-error">{formatAmount(a.money_out)}</td>
            <td className="tabular text-right font-semibold">{formatAmount(a.closing)}</td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

async function Position({ from, to, by }: { from: string; to: string; by: string }) {
  const report = await getCashBankReport(from, to);
  if (!report) return <ErrorState title="Unable to load the cash position" />;
  const csv: (string | number)[][] = [
    ['Account', 'Kind', 'Opening', 'Money in', 'Money out', 'Closing'],
    ...report.accounts.map((a) => [a.name, ACCOUNT_TYPE_META[a.account_type].label, toNumber(a.opening), toNumber(a.money_in), toNumber(a.money_out), toNumber(a.closing)]),
  ];
  return (
    <div className="space-y-gutter">
      <PrintLetterhead title="Consolidated Cash Position" meta={[{ label: 'Period', value: period(from, to) }]} generatedBy={by} />
      <div className="no-print flex justify-end">
        <ExportButtons rows={csv} filename="BUD-SACCO-cash-position" documentTitle="BUD-SACCO Cash Position" />
      </div>
      <ConsolidatedPosition report={report} />
      <AccountBreakdown accounts={report.accounts} />
    </div>
  );
}

async function ReceiptsPayments({ from, to, by }: { from: string; to: string; by: string }) {
  const rp = await getReceiptsAndPayments(from, to);
  if (!rp) return <ErrorState title="Unable to load receipts and payments" />;
  const totalIn = rp.receipts.reduce((s, r) => s + toNumber(r.total), 0);
  const totalOut = rp.payments.reduce((s, r) => s + toNumber(r.total), 0);
  const csv: (string | number)[][] = [
    ['Side', 'Category', 'Entries', 'Amount (UGX)'],
    ...rp.receipts.map((r) => ['Receipts', r.category, r.entries, toNumber(r.total)]),
    ...rp.payments.map((r) => ['Payments', r.category, r.entries, toNumber(r.total)]),
  ];

  const List = ({ title, rows, total, tone }: { title: string; rows: typeof rp.receipts; total: number; tone: string }) => (
    <Panel title={title} icon={tone === 'in' ? 'call_received' : 'call_made'} padded={false}
      action={<span className={`tabular text-button-text font-bold ${tone === 'in' ? 'text-tertiary' : 'text-error'}`}>{formatUGX(total)}</span>}>
      {rows.length === 0 ? (
        <EmptyState compact icon="inbox" title={`No ${title.toLowerCase()} in this period`} />
      ) : (
        <ul className="divide-y divide-outline-variant/70">
          {rows.map((r) => (
            <li key={r.category} className="flex items-baseline justify-between gap-3 px-5 py-3">
              <span className="text-body-md text-on-surface">{r.category}<span className="ml-1.5 text-label-md font-normal text-on-surface-variant">· {r.entries}</span></span>
              <span className="tabular text-body-md font-semibold">{formatUGX(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );

  return (
    <div className="space-y-gutter">
      <PrintLetterhead title="Receipts & Payments" meta={[{ label: 'Period', value: period(from, to) }]} generatedBy={by} />
      <div className="no-print flex justify-end">
        <ExportButtons rows={csv} filename="BUD-SACCO-receipts-and-payments" documentTitle="BUD-SACCO Receipts and Payments" />
      </div>
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
        <List title="Receipts" rows={rp.receipts} total={totalIn} tone="in" />
        <List title="Payments" rows={rp.payments} total={totalOut} tone="out" />
      </div>
      <Panel title="Not counted above" icon="info">
        <ul className="space-y-2 text-body-md text-on-surface-variant">
          <li>
            Internal transfers - money moved between the SACCO&apos;s own accounts:{' '}
            {rp.transfers.length === 0
              ? 'none this period.'
              : rp.transfers.map((t) => `${TRANSFER_KIND_META[t.kind].label} ${formatUGX(t.total)} (${t.entries})`).join(' · ')}
          </li>
          <li>
            Reversals: {rp.reversals.entries === 0
              ? 'none this period.'
              : `${rp.reversals.entries} correcting entries, ${formatUGX(rp.reversals.money_in)} back in and ${formatUGX(rp.reversals.money_out)} back out.`}
          </li>
          <li>
            Net for the period: <span className="tabular font-semibold text-on-surface">{formatUGX(totalIn - totalOut)}</span> before reversals.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

async function Statement({ from, to, accountId, by }: { from: string; to: string; accountId?: string; by: string }) {
  const accounts = await getAccounts();
  if (!accounts) return <ErrorState title="Unable to load accounts" />;
  const account = accounts.find((a) => a.id === accountId);

  const picker = (
    <form className="no-print flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-neu-sm sm:flex-row sm:items-end" method="get">
      <input type="hidden" name="view" value="statement" />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-body-md font-semibold text-on-surface">Account</span>
        <select name="account" defaultValue={accountId ?? ''} className="h-touch-target-primary w-full rounded-full border-0 bg-surface-container px-5 shadow-neu-inset">
          <option value="" disabled>Choose an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_TYPE_META[a.account_type].short})</option>
          ))}
        </select>
      </label>
      <button type="submit" className="inline-flex h-touch-target-primary items-center justify-center gap-2 rounded-full bg-ink px-6 text-button-text font-semibold text-white">
        <Icon name="description" size={18} />
        Show statement
      </button>
    </form>
  );

  if (!account) {
    return (
      <div className="space-y-gutter">
        {picker}
        <div className="rounded-2xl bg-surface shadow-neu">
          <EmptyState icon="description" title="Choose an account" description="The statement lists every entry on one account for the period, with its opening and closing balance." />
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const dayBefore = toISODate(new Date(new Date(`${from}T12:00:00`).getTime() - 86_400_000));
  const [{ data: opening }, { data: closing }, { data: rows, error }] = await Promise.all([
    supabase.rpc('finance_account_balance_at', { p_account_id: account.id, p_on: dayBefore }),
    supabase.rpc('finance_account_balance_at', { p_account_id: account.id, p_on: to }),
    supabase
      .from('account_movements')
      .select('*')
      .eq('account_id', account.id)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: true })
      .order('entry_id', { ascending: true })
      .limit(1000),
  ]);
  if (error) return <ErrorState title="Unable to load the statement" />;
  const list = (rows ?? []) as AccountMovementRow[];
  const totalIn = list.reduce((s, r) => s + toNumber(r.money_in), 0);
  const totalOut = list.reduce((s, r) => s + toNumber(r.money_out), 0);

  const csv: (string | number)[][] = [
    ['Date', 'Reference', 'Description', 'Money in', 'Money out', 'Balance'],
    ['', '', 'Opening balance', '', '', toNumber(opening)],
    ...list.map((r) => [r.entry_date, r.reference, r.description ?? r.category_label, toNumber(r.money_in), toNumber(r.money_out), toNumber(r.running_balance)]),
    ['', '', 'Closing balance', totalIn, totalOut, toNumber(closing)],
  ];

  return (
    <div className="space-y-gutter">
      {picker}
      <PrintLetterhead title="Account Statement" subtitle={account.name} meta={[{ label: 'Period', value: period(from, to) }, { label: 'Account', value: account.code }]} generatedBy={by} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Opening balance', value: opening },
          { label: 'Money in', value: totalIn },
          { label: 'Money out', value: totalOut },
          { label: 'Closing balance', value: closing },
        ].map((f) => (
          <div key={f.label} className="rounded-2xl bg-surface p-4 shadow-neu-sm">
            <p className="text-label-md font-normal text-on-surface-variant">{f.label}</p>
            <p className="tabular text-button-text font-bold text-on-surface">{formatUGX(f.value)}</p>
          </div>
        ))}
      </div>
      <div className="no-print flex justify-end">
        <ExportButtons rows={csv} filename={`BUD-SACCO-statement-${account.code}`} documentTitle={`BUD-SACCO Statement ${account.name}`} />
      </div>
      <LedgerTable rows={list} showAccount={false}
        emptyTitle="No entries in this period" emptyBody="The opening and closing balances above are the same." />
      <PrintFooter note="Every figure on this statement is read from the SACCO account ledger at the time of printing." />
    </div>
  );
}

function MoreReports({ from, to }: { from: string; to: string }) {
  const links = [
    { href: '/staff/finance/merchant', icon: 'smartphone', title: 'Merchant report', body: 'Balance, collections, transfers and history.' },
    { href: '/staff/finance/bank', icon: 'account_balance', title: 'Bank report', body: 'Balance, receipts, deposits, withdrawals and payments.' },
    { href: '/staff/finance/cash', icon: 'payments', title: 'Cash report', body: 'Cash at hand, collections, deposits and payments.' },
    { href: `/staff/finance/income-expenses?from=${from}&to=${to}`, icon: 'balance', title: 'Income & Expenses', body: 'Income against operating expenses, and the surplus.' },
    { href: '/staff/finance/reconciliation', icon: 'fact_check', title: 'Reconciliation', body: 'System against actual balances, with every variance.' },
    { href: `/staff/finance/ledger?from=${from}&to=${to}`, icon: 'list_alt', title: 'Transaction history', body: 'Every entry on every account, filterable.' },
  ];
  return (
    <section className="no-print">
      <h2 className="mb-3 text-title-md text-on-surface">More finance reports</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-start gap-3 rounded-2xl bg-surface p-4 shadow-neu transition-shadow hover:shadow-card-hover">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary">
              <Icon name={l.icon} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-semibold text-on-surface">{l.title}</span>
              <span className="mt-0.5 block text-body-md text-on-surface-variant">{l.body}</span>
            </span>
            <Icon name="chevron_right" size={20} className="shrink-0 text-on-surface-variant" />
          </Link>
        ))}
      </div>
    </section>
  );
}
