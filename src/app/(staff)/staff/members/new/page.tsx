import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getSavingsCategories, getShareCategories } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { getBrand } from '@/lib/brand';
import { MemberForm } from './MemberForm';

export const metadata: Metadata = { title: 'Register a Member' };

export default async function NewMemberPage() {
  const user = await requirePermission('members.manage');
  const mayCategorise = can(user.role, 'categories.manage');

  const [shareCategories, savingsCategories, brand] = await Promise.all([
    mayCategorise ? getShareCategories() : Promise.resolve([]),
    mayCategorise ? getSavingsCategories() : Promise.resolve([]),
    getBrand(),
  ]);

  return (
    <div>
      <PageTitle
        title="Register a Member"
        subtitle={`Enrol a new member of ${brand.legalName}.`}
      />
      <MemberForm shareCategories={shareCategories} savingsCategories={savingsCategories} />
    </div>
  );
}
