import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAccounts, getIncomeCategories } from '@/lib/treasury';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/states';
import { OtherReceiptForm } from '@/components/finance/forms/OtherReceiptForm';

export const metadata: Metadata = { title: 'Other Receipt' };

export default async function NewReceiptPage() {
  const user = await requirePermission('finance.record');
  const [accounts, categories] = await Promise.all([getAccounts({ activeOnly: true }), getIncomeCategories()]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        icon="call_received"
        title="Record Other Receipt"
        subtitle="Money received that is not a member contribution - bank interest, a grant, rent, a non-member's fee."
        breadcrumb={[
          { label: 'Finance', href: '/staff/finance' },
          { label: 'Receipts', href: '/staff/finance/receipts' },
          { label: 'Other receipt' },
        ]}
      />
      {accounts ? (
        <OtherReceiptForm accounts={accounts} categories={categories} recorderName={user.fullName} doneHref="/staff/finance/receipts" />
      ) : (
        <ErrorState title="Unable to load the accounts" />
      )}
    </div>
  );
}
