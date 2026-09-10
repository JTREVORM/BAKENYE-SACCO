import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAccounts, getExpenseCategories } from '@/lib/treasury';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/states';
import { ExpenseForm } from '@/components/finance/forms/ExpenseForm';

export const metadata: Metadata = { title: 'Record Expense' };

export default async function NewExpensePage() {
  const user = await requirePermission('finance.record');
  const [accounts, categories] = await Promise.all([getAccounts({ activeOnly: true }), getExpenseCategories()]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        icon="trending_down"
        title="Record Expense"
        subtitle="Money the SACCO spent. It is filed for approval; nothing leaves the account until a manager approves it."
        breadcrumb={[
          { label: 'Finance', href: '/staff/finance' },
          { label: 'Expenses', href: '/staff/finance/expenses' },
          { label: 'New' },
        ]}
      />
      {accounts ? (
        <ExpenseForm accounts={accounts} categories={categories} recorderName={user.fullName} doneHref="/staff/finance/expenses" />
      ) : (
        <ErrorState title="Unable to load the accounts" />
      )}
    </div>
  );
}
