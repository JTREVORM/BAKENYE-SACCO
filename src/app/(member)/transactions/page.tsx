import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireMember } from '@/lib/auth';
import { getUnreadCount } from '@/lib/queries';
import { queryTransactions, TXN_PAGE_SIZE } from '@/lib/txn-query';
import { MemberShell } from '@/components/layout/MemberShell';
import { TransactionList } from '@/components/TransactionList';
import { ListSkeleton, ErrorState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Transactions' };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  const user = await requireMember();
  const unread = await getUnreadCount();
  const sp = await searchParams;

  return (
    <MemberShell unreadCount={unread}>
      <div className="py-4">
        <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface mb-1">
          Transactions
        </h1>
        <p className="text-body-md font-body-md text-on-surface-variant mb-5">
          Every payment on your membership, newest first.
        </p>

        <Suspense fallback={<ListSkeleton rows={6} />}>
          <Feed memberId={user.memberId} sp={sp} />
        </Suspense>
      </div>
    </MemberShell>
  );
}

async function Feed({
  memberId,
  sp,
}: {
  memberId: string;
  sp: { q?: string; type?: string; page?: string };
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  try {
    const { rows, total } = await queryTransactions({
      memberId,
      query: sp.q,
      type: sp.type,
      page,
    });

    return (
      <TransactionList
        rows={rows}
        total={total}
        page={page}
        pageSize={TXN_PAGE_SIZE}
        basePath="/transactions"
      />
    );
  } catch {
    return (
      <ErrorState
        title="Unable to load transactions"
        description="Please check your connection and try again."
      />
    );
  }
}
