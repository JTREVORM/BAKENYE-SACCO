import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getMemberCollectionView } from '@/lib/queries';
import { getCollectionAccounts } from '@/lib/access-queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState, ListSkeleton, PanelSkeleton } from '@/components/ui/states';
import { CollectSearch } from './CollectSearch';
import { MemberCollectionPanel } from '@/components/collections/MemberCollectionPanel';
import type { MemberFinancialsRow } from '@/types/db';

export const metadata: Metadata = { title: 'Collect savings' };

const RESULT_LIMIT = 8;

/**
 * Savings collection.
 *
 * There is no sheet to work down and nothing expected of anybody, so collection
 * is centralised on the member: search for whoever is at the counter, see where
 * they stand, and record whatever they have handed over.
 *
 * Both halves are query-string state, which means a cashier can keep a member
 * open in one tab, and a link to "Mary's collection screen" is a real link.
 */
export default async function CollectSavingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; member?: string }>;
}) {
  const user = await requirePermission('savings.view');
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const memberId = sp.member ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Collect savings"
        subtitle="Find a member and record whatever they want to save. Any amount, as often as they like."
      />

      <div className="gap-gutter grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Suspense key={query} fallback={<ListSkeleton rows={4} />}>
            <Results query={query} selectedId={memberId} />
          </Suspense>
        </div>

        <div className="min-w-0">
          {memberId ? (
            <Suspense key={memberId} fallback={<PanelSkeleton />}>
              <Selected
                memberId={memberId}
                canRecord={can(user, 'savings.record')}
              />
            </Suspense>
          ) : (
            <div className="bg-surface shadow-card text-on-surface-variant text-body-md font-body-md flex min-h-[16rem] items-center justify-center rounded-xl p-8 text-center">
              Choose a member on the left to open their savings position.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function Results({ query, selectedId }: { query: string; selectedId: string | null }) {
  if (!query) {
    return <CollectSearch query="" results={[]} selectedId={selectedId} />;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_members', {
    p_query: query,
    p_status: 'active',
    p_sort: 'name',
    p_limit: RESULT_LIMIT,
    p_offset: 0,
  });

  if (error || !data) {
    return (
      <ErrorState
        title="Unable to search the register"
        description="Please check your connection and try again."
      />
    );
  }

  const result = data as { rows: MemberFinancialsRow[] };
  return <CollectSearch query={query} results={result.rows} selectedId={selectedId} />;
}

async function Selected({
  memberId,
  canRecord,
}: {
  memberId: string;
  canRecord: boolean;
}) {
  // This raises the current cycle's schedule if it does not exist yet, so a
  // member standing at the counter never produces an empty screen. The accounts
  // the money may be received into come from Finance alongside it.
  const [view, accounts] = await Promise.all([
    getMemberCollectionView(memberId),
    getCollectionAccounts(),
  ]);

  if (!view) {
    return (
      <ErrorState
        title="Unable to open this member"
        description="They may have been removed, or the connection dropped. Try the search again."
      />
    );
  }

  return <MemberCollectionPanel view={view} canRecord={canRecord} accounts={accounts} />;
}
