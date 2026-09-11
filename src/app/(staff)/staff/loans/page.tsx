import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { TableSkeleton, ErrorState } from '@/components/ui/states';
import { LoansBrowser } from './LoansBrowser';
import { toNumber } from '@/lib/money';
import type { LoanPortfolioRow, LoanStatus } from '@/types/db';

export const metadata: Metadata = { title: 'Loans' };

const PAGE_SIZE = 25;

export default async function StaffLoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; member?: string }>;
}) {
  const user = await requirePermission('loans.view');
  const sp = await searchParams;

  return (
    <div>
      <PageTitle
        title="Loans"
        subtitle="Applications, active loans and the collections position."
      />
      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={7} />}>
        <Portfolio sp={sp} canReview={can(user, 'loans.assess')} />
      </Suspense>
    </div>
  );
}

async function Portfolio({
  sp,
  canReview,
}: {
  sp: { status?: string; q?: string; page?: string; member?: string };
  canReview: boolean;
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const supabase = await createClient();

  // "Overdue" is not a loan status — it is a property of a live loan. Ask the
  // database for the live loans and narrow to the overdue ones here, so the
  // filter means what a collections officer expects it to mean.
  const overdueView = sp.status === 'overdue';
  const statusParam = overdueView ? null : ((sp.status as LoanStatus) || null);

  const { data, error } = await supabase.rpc('loan_portfolio', {
    p_status: statusParam,
    p_from: null,
    p_to: null,
    p_limit: overdueView ? 200 : PAGE_SIZE,
    p_offset: overdueView ? 0 : (page - 1) * PAGE_SIZE,
  });

  if (error || !data) {
    return (
      <ErrorState
        title="Unable to load the loan portfolio"
        description="Please check your connection and try again."
      />
    );
  }

  const result = data as { rows: LoanPortfolioRow[]; total: number };
  let rows = result.rows;
  let total = result.total;

  if (overdueView) {
    rows = rows.filter((r) => toNumber(r.overdue_amount) > 0);
    total = rows.length;
    rows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }

  if (sp.member) {
    rows = rows.filter((r) => r.member_id === sp.member);
    total = rows.length;
  }

  return (
    <LoansBrowser
      rows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      canReview={canReview}
    />
  );
}
