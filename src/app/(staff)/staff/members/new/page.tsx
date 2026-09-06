import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { PageTitle } from '@/components/ui/primitives';
import { MemberForm } from './MemberForm';

export const metadata: Metadata = { title: 'Register a Member' };

export default async function NewMemberPage() {
  await requirePermission('members.manage');

  return (
    <div>
      <PageTitle
        title="Register a Member"
        subtitle="Enrol a new member of Bakenye National Development SACCO."
      />
      <MemberForm />
    </div>
  );
}
