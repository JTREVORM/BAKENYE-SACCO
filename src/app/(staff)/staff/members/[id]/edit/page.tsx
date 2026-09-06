import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getMemberFinancials } from '@/lib/queries';
import { PageTitle } from '@/components/ui/primitives';
import { MemberForm } from '../../new/MemberForm';

export const metadata: Metadata = { title: 'Edit Member' };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('members.manage');
  const { id } = await params;
  const member = await getMemberFinancials(id);

  if (!member) notFound();

  return (
    <div>
      <PageTitle title={`Edit ${member.full_name}`} subtitle={member.member_no} />
      <MemberForm member={member} />
    </div>
  );
}
