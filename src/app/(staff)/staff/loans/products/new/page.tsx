import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { PageTitle } from '@/components/ui/primitives';
import { Alert } from '@/components/ui/states';
import { LoanProductForm } from '@/components/loans/LoanProductForm';
import { getRules } from '@/lib/settings';

export const metadata: Metadata = { title: 'New Loan Product' };

/**
 * Create a loan product.
 *
 * Guarded by `settings.manage` rather than `loans.view`: defining what
 * borrowing costs is a configuration act, not a lending one, and a loan officer
 * who may write loans is deliberately not someone who may reprice them.
 */
export default async function NewLoanProductPage() {
  await requirePermission('settings.manage');
  const rules = await getRules();

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="add"
        title="New loan product"
        subtitle="Set the terms members will borrow under. Nothing is charged until a loan is actually written."
        breadcrumb={[
          { label: 'Staff', href: '/staff' },
          { label: 'Loans', href: '/staff/loans' },
          { label: 'Products', href: '/staff/loans/products' },
          { label: 'New' },
        ]}
      />

      <Alert tone="info" title="The figures below become real the moment a member applies">
        A product is a price list. Once it is active, any member who qualifies may take a loan
        on exactly these terms, and those terms are then fixed on their loan for its whole life.
      </Alert>

      <LoanProductForm
        canManage
        defaults={{ gracePeriodDays: rules.defaultGracePeriodDays, latePenaltyPct: rules.defaultLatePenaltyPct }}
      />
    </div>
  );
}
