import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAccounts, getPaymentCategories } from '@/lib/treasury';
import { approvalNoteFor } from '@/lib/treasury-rules';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/states';
import { PaymentForm } from '@/components/finance/forms/PaymentForm';

export const metadata: Metadata = { title: 'Record Payment' };

export default async function NewPaymentPage() {
  const user = await requirePermission('finance.record');
  const [accounts, categories, approvalNote] = await Promise.all([
    getAccounts({ activeOnly: true }),
    getPaymentCategories(),
    approvalNoteFor(user.role),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        icon="request_quote"
        title="Record Payment"
        subtitle="Money paid out that is not an operating expense - a refund, a dividend, an asset."
        breadcrumb={[
          { label: 'Finance', href: '/staff/finance' },
          { label: 'Payments', href: '/staff/finance/payments' },
          { label: 'New' },
        ]}
      />
      {accounts ? (
        <PaymentForm accounts={accounts} categories={categories} recorderName={user.fullName}
          approvalNote={approvalNote} doneHref="/staff/finance/payments" />
      ) : (
        <ErrorState title="Unable to load the accounts" />
      )}
    </div>
  );
}
