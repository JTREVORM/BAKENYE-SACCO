import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getActiveGroups } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { getBrand } from '@/lib/brand';
import { MemberForm } from './MemberForm';

export const metadata: Metadata = { title: 'Register a Member' };

export default async function NewMemberPage() {
  const user = await requirePermission('members.manage');
  const groups = can(user.role, 'groups.manage') ? await getActiveGroups() : [];
  const brand = await getBrand();

  return (
    <div>
      <PageTitle
        title="Register a Member"
        subtitle={`Enrol a new member of ${brand.legalName}.`}
      />
      <MemberForm groups={groups} />
    </div>
  );
}
