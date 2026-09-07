import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/rbac';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { TableSkeleton, ErrorState } from '@/components/ui/states';
import { GroupsBrowser } from '@/components/groups/GroupsBrowser';
import type { GroupOverviewRow, GroupStatus, SavingDay } from '@/types/db';

export const metadata: Metadata = { title: 'Groups' };

const PAGE_SIZE = 20;

/**
 * The group register.
 *
 * A group is not an account — it is a collection unit. Every figure on this
 * screen is the sum of what its members individually saved, so opening a group
 * and adding up its members can never disagree with the list.
 */
export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; day?: string; page?: string }>;
}) {
  const user = await requirePermission('groups.view');
  const sp = await searchParams;
  const canManage = can(user.role, 'groups.manage');

  return (
    <div>
      <PageTitle
        title="Groups"
        subtitle="Each group saves on its own day. Members belong to one."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/staff/savings/today"
              className="border-outline-variant bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg border px-4 font-semibold transition-colors"
            >
              <Icon name="event_available" size={20} />
              <span className="hidden sm:inline">Today’s collections</span>
              <span className="sm:hidden">Today</span>
            </Link>
            {canManage ? (
              <Link
                href="/staff/groups/new"
                className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-sm transition-colors"
              >
                <Icon name="add" size={20} />
                <span className="hidden sm:inline">New group</span>
                <span className="sm:hidden">New</span>
              </Link>
            ) : null}
          </div>
        }
      />

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={6} cols={6} />}>
        <Register sp={sp} canManage={canManage} />
      </Suspense>
    </div>
  );
}

async function Register({
  sp,
  canManage,
}: {
  sp: { q?: string; status?: string; day?: string; page?: string };
  canManage: boolean;
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const day = Number(sp.day);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('search_groups', {
    p_query: sp.q?.trim() || null,
    p_status: (sp.status as GroupStatus) || null,
    p_saving_day: day >= 1 && day <= 7 ? (day as SavingDay) : null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });

  if (error || !data) {
    return (
      <ErrorState
        title="Unable to load the group register"
        description="Please check your connection and try again."
      />
    );
  }

  const result = data as { rows: GroupOverviewRow[]; total: number };

  return (
    <GroupsBrowser
      rows={result.rows}
      total={result.total}
      page={page}
      pageSize={PAGE_SIZE}
      canManage={canManage}
    />
  );
}
