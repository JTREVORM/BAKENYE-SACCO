import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAssignableOfficers } from '@/lib/queries';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { GroupForm } from '@/components/groups/GroupForm';

export const metadata: Metadata = { title: 'New group' };

export default async function NewGroupPage() {
  await requirePermission('groups.manage');
  const officers = await getAssignableOfficers();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/staff/groups"
        className="text-label-md font-label-md text-on-surface-variant hover:text-primary mb-3 inline-flex items-center gap-1 normal-case"
      >
        <Icon name="arrow_back" size={18} />
        Groups
      </Link>

      <PageTitle
        title="New group"
        subtitle="Give the group its meeting day and target; members are added afterwards."
      />

      <GroupForm officers={officers} />
    </div>
  );
}
