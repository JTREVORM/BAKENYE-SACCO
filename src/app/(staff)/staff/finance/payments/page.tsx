import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { ActionLink } from '@/components/finance/ActionLink';
import { PaymentRegister, type PaymentRegisterParams } from '@/components/finance/PaymentRegister';

export const metadata: Metadata = { title: 'Payments' };

/**
 * Everything the SACCO paid out as a document - payments and expenses side by
 * side, each with its BND-PAY number, the account it left and who approved it.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<PaymentRegisterParams> }) {
  const user = await requirePermission('finance.view');
  const sp = await searchParams;

  return (
    <div className="space-y-gutter">
      <PageTitle
        icon="request_quote"
        title="Payments"
        subtitle="Money paid out - payments and approved expenses - with the account it left."
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: 'Payments' }]}
        action={
          can(user.role, 'finance.record') ? (
            <>
              <ActionLink href="/staff/finance/new/payment" icon="add" label="Record payment" primary />
              <ActionLink href="/staff/finance/new/expense" icon="trending_down" label="Record expense" />
            </>
          ) : undefined
        }
      />
      <PaymentRegister sp={sp} user={user} />
    </div>
  );
}
