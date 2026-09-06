import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { queryTransactions, TXN_PAGE_SIZE } from '@/lib/txn-query';
import { can } from '@/lib/rbac';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { ListSkeleton, ErrorState } from '@/components/ui/states';
import { TransactionList } from '@/components/TransactionList';

export const metadata: Metadata = { title: 'Transactions' };

export default async function StaffTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission('transactions.view');
  const sp = await searchParams;

  return (
    <div>
      <PageTitle
        title="Transactions"
        subtitle="Every posting to the SACCO ledger, newest first."
        action={
          can(user.role, 'cash.movement') ? (
            <div className="flex gap-2">
              <Link
                href="/staff/transactions/cash?type=deposit"
                className="bg-primary text-on-primary hover:bg-primary-container h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg px-4 font-semibold transition-colors"
              >
                <Icon name="add_circle" size={20} />
                <span className="hidden sm:inline">Deposit</span>
              </Link>
              <Link
                href="/staff/transactions/cash?type=withdrawal"
                className="border-outline-variant bg-surface text-primary hover:bg-surface-container-high h-touch-target-min text-button-text font-button-text inline-flex items-center gap-2 rounded-lg border px-4 font-semibold transition-colors"
              >
                <Icon name="remove_circle" size={20} />
                <span className="hidden sm:inline">Withdrawal</span>
              </Link>
            </div>
          ) : undefined
        }
      />

      <Suspense key={JSON.stringify(sp)} fallback={<ListSkeleton rows={8} />}>
        <Feed sp={sp} />
      </Suspense>
    </div>
  );
}

async function Feed({
  sp,
}: {
  sp: { q?: string; type?: string; page?: string; from?: string; to?: string };
}) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  try {
    const { rows, total } = await queryTransactions({
      query: sp.q,
      type: sp.type,
      from: sp.from,
      to: sp.to,
      page,
    });

    return (
      <TransactionList
        rows={rows}
        total={total}
        page={page}
        pageSize={TXN_PAGE_SIZE}
        basePath="/staff/transactions"
        showMember
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
