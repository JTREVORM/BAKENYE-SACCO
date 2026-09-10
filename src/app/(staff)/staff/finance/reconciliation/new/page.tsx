import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAccounts } from '@/lib/treasury';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/states';
import { ReconcileForm } from '@/components/finance/forms/ReconcileForm';

export const metadata: Metadata = { title: 'Reconcile an account' };

export default async function NewReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const user = await requirePermission('finance.reconcile');
  const sp = await searchParams;
  const accounts = await getAccounts();

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        icon="fact_check"
        title="Reconcile an account"
        subtitle="Compare the system balance with the merchant balance, the bank statement or the cash count."
        breadcrumb={[
          { label: 'Finance', href: '/staff/finance' },
          { label: 'Reconciliation', href: '/staff/finance/reconciliation' },
          { label: 'New' },
        ]}
      />
      {accounts ? (
        <ReconcileForm
          accounts={accounts}
          initialAccountId={accounts.some((a) => a.id === sp.account) ? sp.account : undefined}
          recorderName={user.fullName}
          doneHref="/staff/finance/reconciliation"
        />
      ) : (
        <ErrorState title="Unable to load the accounts" />
      )}
    </div>
  );
}
