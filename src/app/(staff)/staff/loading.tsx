import { StatGridSkeleton, TableSkeleton } from '@/components/ui/states';

export default function StaffLoading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="skeleton h-8 w-48 rounded" />
        <div className="skeleton mt-2 h-4 w-72 rounded" />
      </div>
      <StatGridSkeleton />
      <TableSkeleton rows={6} cols={5} />
    </div>
  );
}
