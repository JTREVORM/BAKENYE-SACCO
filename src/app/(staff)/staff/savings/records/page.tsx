import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { SavingsRecordsBrowser } from './SavingsRecordsBrowser';
import { ExportButtons } from '@/components/ExportButtons';
import { PrintFooter, PrintLetterhead } from '@/components/print/PrintLetterhead';
import { documentName } from '@/lib/print';
import { formatAmount, formatUGX, toNumber } from '@/lib/money';
import { formatDate } from '@/lib/format';
import type { SavingsScheduleRow } from '@/types/db';

export const metadata: Metadata = { title: 'Savings records' };

const PAGE_SIZE = 25;

/**
 * Every member's savings, month by month, across the whole membership.
 *
 * This was the schedules register, and it doubled as the arrears register: it
 * listed what each member was expected to save and what they still owed.
 * Savings are open now, so there is nothing expected and nothing owed. What is
 * left — and what the SACCO actually needs — is the record of what came in:
 * which member, which month, how many deposits, how much.
 *
 * Records are never deleted, so a month somebody saved in three years ago is
 * still here with what they saved.
 */
export default async function SavingsRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    saved?: string;
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
          title="Savings records"
          subtitle="What each member saved, month by month. Savings are open — nothing is expected and nothing is owed."
        />
      </div>

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={5} />}>
        <Records sp={sp} generatedBy={user.fullName} />
      </Suspense>
    </div>
  );
}

async function Records({
  sp,
  generatedBy,
}: {
  sp: { q?: string; saved?: string; from?: string; to?: string; page?: string };
  generatedBy: string;
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const supabase = await createClient();

  let query = supabase
    .from('savings_schedules')
    .select('*', { count: 'exact' })
    .order('period_start', { ascending: false })
    .order('member_name', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // The one filter that still means something: months money went into, or
  // months it did not. Neither is a problem — it is simply what happened.
  if (sp.saved === 'yes') query = query.gt('paid_amount', 0);
  if (sp.saved === 'no') query = query.eq('paid_amount', 0);
  if (sp.from) query = query.gte('period_start', sp.from);
  if (sp.to) query = query.lte('period_end', sp.to);
  if (sp.q?.trim()) {
    const term = `%${sp.q.trim()}%`;
    query = query.or(`member_name.ilike.${term},member_no.ilike.${term}`);
  }

  const { data, count, error } = await query;

  if (error) {
    return (
      <ErrorState
        title="Unable to load savings records"
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
      saved: acc.saved + toNumber(r.saved_amount),
      deposits: acc.deposits + toNumber(r.deposits),
    }),
    { saved: 0, deposits: 0 },
  );

  const csv = [
    ['Member No', 'Member', 'Month', 'Deposits', 'Saved', 'Last deposit'],
    ...rows.map((r) => [
      r.member_no,
      r.member_name,
      r.cycle,
      r.deposits,
      formatAmount(r.saved_amount),
      r.last_paid_on ?? '',
    ]),
    [],
    ['TOTAL (this page)', '', '', totals.deposits, formatAmount(totals.saved)],
  ];

  return (
    <>
      <PrintLetterhead
        title="Savings Records"
        subtitle="Open monthly savings"
        generatedBy={generatedBy}
        meta={[
          {
            label: 'Months between',
            value:
              sp.from || sp.to
                ? `${sp.from ? formatDate(sp.from) : 'the beginning'} and ${
                    sp.to ? formatDate(sp.to) : 'today'
                  }`
                : 'Any date',
          },
          { label: 'Records', value: String(rows.length) },
          { label: 'Deposits', value: String(totals.deposits) },
          { label: 'Saved', value: formatUGX(totals.saved) },
        ]}
      />

      <div className="mb-4 flex justify-end print:hidden">
        <ExportButtons
          rows={csv}
          filename="savings-records"
          documentTitle={documentName('Savings Records', 'Open monthly savings')}
        />
      </div>

      <SavingsRecordsBrowser
        rows={rows}
        total={count ?? rows.length}
        page={page}
        pageSize={PAGE_SIZE}
        totals={totals}
      />

      <PrintFooter note="Figures cover the records listed on this page. Every one is computed from the member transaction ledger." />
    </>
  );
}
