import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getActiveGroups } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { MemberForm } from './MemberForm';

export const metadata: Metadata = { title: 'Register a Member' };

export default async function NewMemberPage() {
  const user = await requirePermission('members.manage');
  const groups = can(user.role, 'groups.manage') ? await getActiveGroups() : [];

  return (
    <div>
      <PageTitle
        title="Register a Member"
        subtitle="Enrol a new member of Bakenye Unity and Development SACCO."
      />
      <MemberForm groups={groups} />
    </div>
  );
}
