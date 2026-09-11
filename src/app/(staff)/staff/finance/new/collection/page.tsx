import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { canAny } from '@/lib/rbac';
import { getShareUnitPrice } from '@/lib/queries';
import { getPickedMember } from '@/lib/picked-member';
import { getAccounts, getIncomeCategories } from '@/lib/treasury';
import { PageTitle } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/states';
import { MemberCollectionForm } from '@/components/finance/forms/MemberCollectionForm';
import type { CollectionType } from '@/types/treasury';

export const metadata: Metadata = { title: 'Record Collection' };

const TYPES: CollectionType[] = ['savings', 'shares', 'loan_repayment', 'deposit', 'fee'];

export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; member?: string; type?: string }>;
}) {
  const user = await requireUser();
  if (!canAny(user, 'finance.record', 'savings.record')) redirect('/staff/finance');
  const sp = await searchParams;
  const merchant = sp.preset === 'merchant';

  const [accounts, categories, sharePrice, member] = await Promise.all([
    getAccounts({ activeOnly: true }),
    getIncomeCategories(),
    getShareUnitPrice(),
    getPickedMember(sp.member),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        icon={merchant ? 'smartphone' : 'point_of_sale'}
        title={merchant ? 'Record Merchant Collection' : 'Record Collection'}
        subtitle={
          merchant
            ? 'A member payment already received through the SACCO merchant code. It goes to Cash at Merchant.'
            : 'A member payment - savings, shares, a repayment or a fee - into the account it was received in.'
        }
        breadcrumb={[{ label: 'Finance', href: '/staff/finance' }, { label: merchant ? 'Merchant collection' : 'Collection' }]}
      />
      {accounts ? (
        <MemberCollectionForm
          accounts={accounts}
          incomeCategories={categories}
          sharePrice={sharePrice}
          recorderName={user.fullName}
          preset={merchant ? 'merchant' : undefined}
          initialMember={member}
          initialType={TYPES.includes(sp.type as CollectionType) ? (sp.type as CollectionType) : undefined}
          doneHref="/staff/finance"
        />
      ) : (
        <ErrorState title="Unable to load the accounts" />
      )}
    </div>
  );
}
