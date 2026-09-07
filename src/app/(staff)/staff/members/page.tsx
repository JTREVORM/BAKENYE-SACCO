import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getActiveGroups } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { TableSkeleton, ErrorState } from '@/components/ui/states';
import { MembersBrowser } from './MembersBrowser';
import type { MemberFinancialsRow, MemberStatus } from '@/types/db';

export const metadata: Metadata = { title: 'Members' };

const PAGE_SIZE = 20;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    page?: string;
    /** A group id, or `none` for members not placed in any group. */
    group?: string;
  }>;
}) {
  const user = await requirePermission('members.view');
  const sp = await searchParams;
  const canRegister = can(user.role, 'members.manage');

  return (
    <div>
      <PageTitle
        title="Members"
        subtitle="The SACCO register, with each member's current position."
        action={
          canRegister ? (
            <Link
              href="/staff/members/new"
              className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold shadow-sm transition-colors"
            >
              <Icon name="person_add" size={20} />
              <span className="hidden sm:inline">Register member</span>
              <span className="sm:hidden">Register</span>
            </Link>
          ) : undefined
        }
      />

      <Suspense key={JSON.stringify(sp)} fallback={<TableSkeleton rows={8} cols={6} />}>
        <Directory sp={sp} canRegister={canRegister} />
      </Suspense>
    </div>
  );
}

async function Directory({
  sp,
  canRegister,
}: {
  sp: { q?: string; status?: string; sort?: string; page?: string; group?: string };
  canRegister: boolean;
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const supabase = await createClient();
  const groups = await getActiveGroups();

  const unassigned = sp.group === 'none';

  const { data, error } = await supabase.rpc('search_members', {
    p_query: sp.q?.trim() || null,
    p_status: (sp.status as MemberStatus) || null,
    p_sort: sp.sort ?? 'name',
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_group_id: unassigned ? null : sp.group || null,
    p_unassigned: unassigned,
  });

  if (error || !data) {
    return (
      <ErrorState
        title="Unable to load the member register"
        description="Please check your connection and try again."
      />
    );
  }

  const result = data as { rows: MemberFinancialsRow[]; total: number };

  return (
    <MembersBrowser
      rows={result.rows}
      total={result.total}
      page={page}
      pageSize={PAGE_SIZE}
      canRegister={canRegister}
      groups={groups}
    />
  );
}
