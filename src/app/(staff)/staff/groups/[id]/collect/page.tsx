import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { getCollectionSheet } from '@/lib/queries';
import { can } from '@/lib/rbac';
import { Icon, PageTitle } from '@/components/ui/primitives';
import { CollectionSheet } from '@/components/collections/CollectionSheet';
import { OpenCycleButton } from '@/components/groups/OpenCycleButton';
import { savingDayLabel } from '@/lib/groups';

export const metadata: Metadata = { title: 'Collections' };

/**
 * The collection screen.
 *
 * One group, one cycle, one row per member. Staff record what each person
 * actually brought; the schedule statuses and the group totals fall out of
 * those individual entries rather than being typed anywhere.
 */
export default async function GroupCollectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const user = await requirePermission('savings.view');
  const { id } = await params;
  const { cycle } = await searchParams;

  const sheet = await getCollectionSheet(id, cycle ?? null);
  if (!sheet) notFound();

  const canRecord = can(user.role, 'savings.record');

  return (
    <div className="space-y-6">
      <Link
        href={`/staff/groups/${id}`}
        className="text-label-md font-label-md text-on-surface-variant hover:text-primary inline-flex items-center gap-1 normal-case"
      >
        <Icon name="arrow_back" size={18} />
        {sheet.group.name}
      </Link>

      <PageTitle
        title={`${savingDayLabel(sheet.group.saving_day)} collections`}
        subtitle={`${sheet.group.name} · ${sheet.group.group_code}${sheet.group.location ? ` · ${sheet.group.location}` : ''}`}
        action={
          canRecord ? (
            <OpenCycleButton
              groupId={sheet.group.id}
              savingDay={sheet.group.saving_day}
              frequency={sheet.group.saving_frequency}
              variant={sheet.cycle ? 'outline' : 'primary'}
              label={sheet.cycle ? 'Open another cycle' : 'Open cycle'}
            />
          ) : undefined
        }
      />

      <CollectionSheet
        sheet={sheet}
        canRecord={canRecord}
        canWaive={can(user.role, 'savings.waive')}
      />
    </div>
  );
}
