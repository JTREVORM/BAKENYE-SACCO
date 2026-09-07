import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getAssignableOfficers, getGroupOverview } from '@/lib/queries';
import { createClient } from '@/lib/supabase/server';
import { PageTitle, Icon } from '@/components/ui/primitives';
import { GroupForm } from '@/components/groups/GroupForm';
import type { PickedMember } from '@/components/forms/MemberPicker';

export const metadata: Metadata = { title: 'Edit group' };

export default async function EditGroupPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('groups.manage');
  const { id } = await params;

  const group = await getGroupOverview(id);
  if (!group) notFound();

  const [officers, officials] = await Promise.all([
    getAssignableOfficers(),
    loadOfficials(group.leader_member_id, group.secretary_member_id),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/staff/groups/${id}`}
        className="text-label-md font-label-md text-on-surface-variant hover:text-primary mb-3 inline-flex items-center gap-1 normal-case"
      >
        <Icon name="arrow_back" size={18} />
        {group.name}
      </Link>

      <PageTitle
        title="Edit group"
        subtitle="Changing the saving day affects cycles opened from now on, not ones already collected."
      />

      <GroupForm
        group={group}
        officers={officers}
        leader={officials.leader}
        secretary={officials.secretary}
      />
    </div>
  );
}

/**
 * The member picker shows a chosen member as a card, so it needs the same shape
 * the search returns rather than a bare id.
 */
async function loadOfficials(
  leaderId: string | null,
  secretaryId: string | null,
): Promise<{ leader: PickedMember | null; secretary: PickedMember | null }> {
  const ids = [leaderId, secretaryId].filter(Boolean) as string[];
  if (ids.length === 0) return { leader: null, secretary: null };

  const supabase = await createClient();
  const { data } = await supabase
    .from('member_financials')
    .select('id, member_no, full_name, phone, photo_url, savings_balance, share_value')
    .in('id', ids);

  const rows = (data ?? []) as PickedMember[];
  return {
    leader: rows.find((m) => m.id === leaderId) ?? null,
    secretary: rows.find((m) => m.id === secretaryId) ?? null,
  };
}
