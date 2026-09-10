import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { Icon, PageTitle, Money } from '@/components/ui/primitives';
import { ApprovalBadge } from '@/components/ui/status';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { StatementRange } from '@/components/StatementRange';
import { FinanceTabs } from '../FinanceTabs';
import { ExpenseApproval } from '../ExpenseApproval';
import { percent, toNumber } from '@/lib/money';
import { formatDate, monthStart, toISODate, PAYMENT_METHOD_LABELS } from '@/lib/format';
import { clsx } from '@/lib/clsx';
import type { Cashbook, ExpenseEntryRow, IncomeEntryRow } from '@/types/db';

export const metadata: Metadata = { title: 'Income & Expenses' };

/**
 * Income and expenses - the cashbook.
 *
 * This is the income and expenditure view, not the cash view: loan interest,
 * fees and other income against approved operating expenses, and the surplus
 * between them. Internal transfers never appear here, because moving money
 * from the merchant account to the bank earns nothing and costs nothing. An
 * entry whose ledger row has been reversed drops out (see `cashbook()` in
 * 0027), so a corrected mistake does not linger in the surplus.
 *
 * Expenses are a two-step flow by design. `record_expense` only files a
 * request; nothing leaves an account until a manager approves it.
 */
export default async function IncomeExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; approval?: string }>;
}) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;

  const today = new Date();
  const from = isDate(sp.from) ? sp.from! : monthStart(today);
  const to = isDate(sp.to) ? sp.to! : toISODate(today);
  const tab = sp.tab === 'expenses' ? 'expenses' : sp.tab === 'income' ? 'income' : 'summary';

  return (
    <div>
      <PageTitle
        icon="balance"
        title="Income & Expenses"
        subtitle="What the SACCO earned and spent, and the surplus between them. Internal transfers are not income or expense."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Income & Expenses' }]}
        action={
          can(user.role, 'finance.record') ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/staff/finance/new/receipt" className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-surface px-5 text-button-text font-semibold text-on-surface shadow-neu">
                <Icon name="trending_up" size={18} />
                Record income
              </Link>
              <Link href="/staff/finance/new/expense" className="inline-flex h-touch-target-min items-center gap-2 rounded-full bg-surface px-5 text-button-text font-semibold text-on-surface shadow-neu">
                <Icon name="trending_down" size={18} />
                Record expense
              </Link>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <FinanceTabs tab={tab} from={from} to={to} />
        <StatementRange from={from} to={to} />
      </div>

      <Suspense key={`${tab}-${from}-${to}`} fallback={<TableSkeleton rows={8} cols={4} />}>
        {tab === 'summary' ? (
          <Summary from={from} to={to} />
        ) : tab === 'income' ? (
          <IncomeLedger from={from} to={to} />
        ) : (
          <ExpenseLedger
            from={from}
            to={to}
            approvalFilter={sp.approval}
            canApprove={can(user.role, 'finance.approve')}
          />
        )}
      </Suspense>
    </div>
  );
}

async function Summary({ from, to }: { from: string; to: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cashbook', { p_from: from, p_to: to });

  if (error || !data) {
    return <ErrorState title="Unable to load the cashbook" description="Please check your connection and try again." />;
  }

  const book = data as Cashbook;
  const surplus = toNumber(book.net_surplus);

  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="gap-gutter grid grid-cols-1 sm:grid-cols-3">
        <Total label="Total income" value={book.total_income} tone="tertiary" />
        <Total label="Total expenses" value={book.total_expenses} tone="error" />
        <div
          className={clsx(
            'shadow-pop relative overflow-hidden rounded-xl p-5',
            surplus >= 0 ? 'bg-primary text-on-primary' : 'bg-error text-on-error',
          )}
        >
          <p className="text-label-md font-label-md relative z-10 opacity-80">
            {surplus >= 0 ? 'Net surplus' : 'Net deficit'}
          </p>
          <Money value={Math.abs(surplus)} compact className="text-display-currency font-display-currency relative z-10 mt-1" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CategoryPanel title="Income Streams" lines={book.income} total={toNumber(book.total_income)} tone="tertiary"
          emptyTitle="No income recorded" emptyBody="Loan interest, fees and other income will be listed here." />
        <CategoryPanel title="Operating Expenses" lines={book.expenses} total={toNumber(book.total_expenses)} tone="error"
          emptyTitle="No approved expenses" emptyBody="Approved expenses for this period will be listed here." />
      </div>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: unknown; tone: 'tertiary' | 'error' }) {
  return (
    <div className="bg-surface shadow-card rounded-xl p-5">
      <p className="text-label-md font-label-md text-on-surface-variant mb-1">{label}</p>
      <Money value={value} compact className={clsx('text-display-currency font-display-currency', tone === 'tertiary' ? 'text-tertiary' : 'text-error')} />
    </div>
  );
}

function CategoryPanel({
  title, lines, total, tone, emptyTitle, emptyBody,
}: {
  title: string;
  lines: { category: string; total: number; entries: number }[];
  total: number;
  tone: 'tertiary' | 'error';
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <section className="bg-surface shadow-card overflow-hidden rounded-xl">
      <div className="border-outline-variant bg-surface flex items-center justify-between gap-3 border-b p-4">
        <h2 className="text-button-text font-button-text text-on-surface font-bold">{title}</h2>
        <Money value={total} className={clsx('text-button-text font-button-text font-bold', tone === 'tertiary' ? 'text-tertiary' : 'text-error')} />
      </div>
      {lines.length === 0 ? (
        <EmptyState icon="account_balance" title={emptyTitle} description={emptyBody} />
      ) : (
        <ul className="divide-outline-variant/70 divide-y">
          {lines.map((l) => (
            <li key={l.category} className="p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body-md font-body-md text-on-surface truncate font-semibold">{l.category}</span>
                <Money value={l.total} className="text-body-md font-body-md text-on-surface shrink-0 font-semibold" />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="bg-surface-container-highest h-1.5 flex-1 overflow-hidden rounded-full">
                  <div className={clsx('h-full rounded-full', tone === 'tertiary' ? 'bg-tertiary-container' : 'bg-error')}
                    style={{ width: `${percent(l.total, total)}%` }} />
                </div>
                <span className="text-label-md font-label-md text-on-surface-variant shrink-0 normal-case">
                  {Math.round(percent(l.total, total))}% · {l.entries} {l.entries === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function IncomeLedger({ from, to }: { from: string; to: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('income_entries')
    .select('*, income_categories!income_entries_category_id_fkey(name), members!income_entries_member_id_fkey(full_name, member_no)')
    .gte('received_on', from)
    .lte('received_on', to)
    .order('received_on', { ascending: false })
    .limit(200);

  if (error) return <ErrorState title="Unable to load income" />;

  const rows = (data ?? []) as unknown as (IncomeEntryRow & {
    income_categories: { name: string } | null;
    members: { full_name: string; member_no: string } | null;
  })[];
  const total = rows.reduce((s, r) => s + toNumber(r.amount), 0);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="bg-surface shadow-card flex items-baseline justify-between gap-3 rounded-xl p-4">
        <span className="text-body-md font-body-md text-on-surface-variant">
          {rows.length} {rows.length === 1 ? 'entry' : 'entries'} between {formatDate(from)} and {formatDate(to)}
        </span>
        <Money value={total} className="text-headline-lg-mobile font-headline-lg-mobile text-tertiary" />
      </div>
      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState icon="trending_up" title="No income in this period"
            description="Loan interest is booked automatically as repayments come in. Other income is recorded as a receipt." />
        </div>
      ) : (
        <ul className="bg-surface shadow-card divide-outline-variant/70 divide-y overflow-hidden rounded-xl">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-body-md font-body-md text-on-surface truncate font-semibold">{r.income_categories?.name ?? 'Income'}</p>
                <p className="text-body-md font-body-md text-on-surface-variant break-words">{r.description}</p>
                <p className="text-label-md font-label-md text-on-surface-variant/70 mt-1 normal-case">
                  {formatDate(r.received_on)} · {PAYMENT_METHOD_LABELS[r.method]}
                  {r.members ? ` · ${r.members.full_name} (${r.members.member_no})` : ''}
                </p>
              </div>
              <Money value={r.amount} className="text-body-md font-body-md text-tertiary shrink-0 font-bold" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function ExpenseLedger({
  from, to, approvalFilter, canApprove,
}: {
  from: string;
  to: string;
  approvalFilter?: string;
  canApprove: boolean;
}) {
  const supabase = await createClient();
  let query = supabase
    .from('expense_entries')
    .select('*, expense_categories!expense_entries_category_id_fkey(name), app_users!expense_entries_recorded_by_fkey(full_name)')
    .gte('spent_on', from)
    .lte('spent_on', to)
    .order('spent_on', { ascending: false })
    .limit(200);

  if (approvalFilter === 'pending' || approvalFilter === 'approved' || approvalFilter === 'rejected') {
    query = query.eq('approval', approvalFilter);
  }

  const { data, error } = await query;
  if (error) return <ErrorState title="Unable to load expenses" />;

  const rows = (data ?? []) as unknown as (ExpenseEntryRow & {
    expense_categories: { name: string } | null;
    app_users: { full_name: string } | null;
  })[];

  const approved = rows.filter((r) => r.approval === 'approved');
  const pending = rows.filter((r) => r.approval === 'pending');
  const total = approved.reduce((s, r) => s + toNumber(r.amount), 0);
  const pendingTotal = pending.reduce((s, r) => s + toNumber(r.amount), 0);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="bg-surface shadow-card flex flex-wrap items-baseline justify-between gap-3 rounded-xl p-4">
        <div>
          <p className="text-label-md font-label-md text-on-surface-variant">Approved</p>
          <Money value={total} className="text-headline-lg-mobile font-headline-lg-mobile text-error" />
        </div>
        {pending.length > 0 ? (
          <div className="text-right">
            <p className="text-label-md font-label-md text-on-surface-variant">Awaiting approval ({pending.length})</p>
            <Money value={pendingTotal} className="text-headline-lg-mobile font-headline-lg-mobile text-on-secondary-container" />
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl shadow-neu-sm">
          <EmptyState icon="trending_down" title="No expenses in this period"
            description="Submitted expenses appear here. Money only leaves the SACCO once a manager approves them." />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className={clsx('bg-surface shadow-card rounded-xl border p-4', r.approval === 'pending' ? 'border-secondary-container' : 'border-outline-variant')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-md font-body-md text-on-surface truncate font-semibold">{r.expense_categories?.name ?? 'Expense'}</p>
                  <p className="text-body-md font-body-md text-on-surface-variant break-words">{r.description}</p>
                  <p className="text-label-md font-label-md text-on-surface-variant/70 mt-1 normal-case">
                    {r.payment_no ? `${r.payment_no} · ` : ''}
                    {formatDate(r.spent_on)} · {PAYMENT_METHOD_LABELS[r.method]}
                    {r.app_users ? ` · submitted by ${r.app_users.full_name}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Money value={r.amount} className="text-body-md font-body-md text-on-surface block font-bold" />
                  <div className="mt-1">
                    <ApprovalBadge status={r.approval} />
                  </div>
                </div>
              </div>
              {r.approval === 'pending' && canApprove ? (
                <div className="border-outline-variant mt-3 border-t pt-3">
                  <ExpenseApproval expenseId={r.id} amount={toNumber(r.amount)} description={r.description ?? ''} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function isDate(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
