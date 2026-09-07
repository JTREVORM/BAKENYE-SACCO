import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getActiveGroups, getMemberFinancials } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { MemberForm } from '../../new/MemberForm';

export const metadata: Metadata = { title: 'Edit Member' };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('members.manage');
  const { id } = await params;
  const [member, groups] = await Promise.all([
    getMemberFinancials(id),
    can(user.role, 'groups.manage') ? getActiveGroups() : Promise.resolve([]),
  ]);

  if (!member) notFound();

  return (
    <div>
      <PageTitle title={`Edit ${member.full_name}`} subtitle={member.member_no} />
      <MemberForm member={member} groups={groups} />
    </div>
  );
}
