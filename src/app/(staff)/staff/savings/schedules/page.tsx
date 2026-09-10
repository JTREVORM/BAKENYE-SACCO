import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getSavingsCategories } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { SchedulesBrowser } from './SchedulesBrowser';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import { formatDate } from '@/lib/format';
import type { SavingsScheduleRow, SavingsStatus } from '@/types/db';

export const metadata: Metadata = { title: 'Savings schedules' };

const PAGE_SIZE = 25;

/**
 * Every scheduled contribution, across the whole membership.
 *
 * Schedules are never deleted — a missed week in July is still here in
 * September carrying its shortfall — so this doubles as the arrears register.
 */
export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const user = await requirePermission('savings.view');
  const sp = await searchParams;

  return (
    <div>
      <div className="print:hidden">
        <PageTitle
          title="Savings schedules"
          subtitle="What each member was expected to save, what they paid, and what is still owed."
        />
      </div>

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={7} />}>
        <Schedules sp={sp} generatedBy={user.fullName} />
      </Suspense>
    </div>
  );
}

async function Schedules({
  sp,
  generatedBy,
}: {
  sp: {
    q?: string;
    status?: string;
    category?: string;
    from?: string;
    to?: string;
    page?: string;
  };
  generatedBy: string;
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const supabase = await createClient();
  const categories = await getSavingsCategories();

  let query = supabase
    .from('savings_schedules')
    .select('*', { count: 'exact' })
    .order('due_on', { ascending: false })
    .order('member_name', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const status = sp.status as SavingsStatus | undefined;
  if (status) query = query.eq('status', status);
  if (sp.category) query = query.eq('savings_category_id', sp.category);
  if (sp.from) query = query.gte('due_on', sp.from);
  if (sp.to) query = query.lte('due_on', sp.to);
  if (sp.q?.trim()) {
    const term = `%${sp.q.trim()}%`;
    query = query.or(`member_name.ilike.${term},member_no.ilike.${term}`);
  }

  const { data, count, error } = await query;

  if (error) {
    return (
      <ErrorState
        title="Unable to load savings schedules"
        description="Please check your connection and try again."
      />
    );
  }

  const rows = (data ?? []) as SavingsScheduleRow[];

  // Totals for the rows on screen. The whole-database figure would need a
  // separate aggregate call; what a user is reconciling is the page in front
  // of them, and the label says so.
  const totals = rows.reduce(
    (acc, r) => ({
      expected: acc.expected + toNumber(r.expected_amount),
      paid: acc.paid + toNumber(r.paid_amount),
      outstanding: acc.outstanding + toNumber(r.outstanding),
    }),
    { expected: 0, paid: 0, outstanding: 0 },
  );

  const csv = [
    ['Member No', 'Member', 'Category', 'Cycle', 'Due', 'Expected', 'Paid', 'Outstanding', 'Status'],
    ...rows.map((r) => [
      r.member_no,
      r.member_name,
      r.savings_category_name ?? '',
      r.cycle,
      r.due_on,
      formatAmount(r.expected_amount),
      formatAmount(r.paid_amount),
      formatAmount(r.outstanding),
      r.status,
    ]),
    [],
    [
      'TOTAL (this page)',
      '',
      '',
      '',
      '',
      formatAmount(totals.expected),
      formatAmount(totals.paid),
      formatAmount(totals.outstanding),
    ],
  ];

  const scope = categories.find((c) => c.id === sp.category)?.name ?? 'All savings categories';
  const statusLabel = sp.status ? sp.status[0].toUpperCase() + sp.status.slice(1) : 'All statuses';

  return (
    <>
      <PrintLetterhead
        title="Savings Schedules"
        subtitle={`${scope} · ${statusLabel}`}
        generatedBy={generatedBy}
        meta={[
          {
            label: 'Due between',
            value:
              sp.from || sp.to
                ? `${sp.from ? formatDate(sp.from) : 'the beginning'} and ${sp.to ? formatDate(sp.to) : 'today'}`
                : 'Any date',
          },
          { label: 'Schedules', value: String(rows.length) },
          { label: 'Expected', value: formatUGX(totals.expected) },
          { label: 'Paid', value: formatUGX(totals.paid) },
          { label: 'Outstanding', value: formatUGX(totals.outstanding) },
        ]}
      />

      <div className="mb-4 flex justify-end print:hidden">
        <ExportButtons
          rows={csv}
          filename="savings-schedules"
          documentTitle={documentName('Savings Schedules', scope)}
        />
      </div>

      <SchedulesBrowser
        rows={rows}
        total={count ?? rows.length}
        page={page}
        pageSize={PAGE_SIZE}
        categories={categories}
        totals={totals}
      />

      <PrintFooter note="Figures cover the schedules listed on this page. Every one is computed from the member transaction ledger." />
    </>
  );
}
