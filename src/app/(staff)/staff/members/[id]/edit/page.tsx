import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getMemberFinancials, getSavingsCategories, getShareCategories } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { PageTitle } from '@/components/ui/primitives';
import { EditMemberForm } from './EditMemberForm';

export const metadata: Metadata = { title: 'Edit Member' };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('members.manage');
  const { id } = await params;
  const mayCategorise = can(user, 'categories.manage');

  const [member, shareCategories, savingsCategories] = await Promise.all([
    getMemberFinancials(id),
    mayCategorise ? getShareCategories() : Promise.resolve([]),
    mayCategorise ? getSavingsCategories() : Promise.resolve([]),
  ]);

  if (!member) notFound();

  return (
    <div>
      <PageTitle
        icon="edit"
        title={`Edit ${member.full_name}`}
        subtitle={`${member.member_no} · official SACCO record. Every change is recorded with a reason.`}
        breadcrumb={[
          { label: 'Members', href: '/staff/members' },
          { label: member.full_name, href: `/staff/members/${member.id}` },
          { label: 'Edit' },
        ]}
      />
      <EditMemberForm
        member={member}
        shareCategories={shareCategories}
        savingsCategories={savingsCategories}
        canCategorise={mayCategorise}
        canOverridePhone={can(user, 'members.phone_override')}
      />
    </div>
  );
}
