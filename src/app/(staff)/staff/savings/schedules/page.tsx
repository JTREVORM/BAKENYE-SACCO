import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getActiveGroups } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { SchedulesBrowser } from './SchedulesBrowser';
import { toNumber } from '@/lib/money';
import type { SavingsScheduleRow, SavingsStatus } from '@/types/db';

export const metadata: Metadata = { title: 'Savings schedules' };

const PAGE_SIZE = 25;

/**
 * Every scheduled contribution, across every group.
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
    group?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requirePermission('savings.view');
  const sp = await searchParams;

  return (
    <div>
      <PageTitle
        title="Savings schedules"
        subtitle="What each member was expected to save, what they paid, and what is still owed."
      />

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={7} />}>
        <Schedules sp={sp} />
      </Suspense>
    </div>
  );
}

async function Schedules({
  sp,
}: {
  sp: { q?: string; status?: string; group?: string; from?: string; to?: string; page?: string };
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const supabase = await createClient();
  const groups = await getActiveGroups();

  let query = supabase
    .from('savings_schedules')
    .select('*', { count: 'exact' })
    .order('due_on', { ascending: false })
    .order('member_name', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const status = sp.status as SavingsStatus | undefined;
  if (status) query = query.eq('status', status);
  if (sp.group) query = query.eq('group_id', sp.group);
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

  return (
    <SchedulesBrowser
      rows={rows}
      total={count ?? rows.length}
      page={page}
      pageSize={PAGE_SIZE}
      groups={groups}
      totals={totals}
    />
  );
}
