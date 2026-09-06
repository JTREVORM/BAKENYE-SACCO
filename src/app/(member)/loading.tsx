import { BalanceCardSkeleton, ListSkeleton } from '@/components/ui/states';

export default function MemberLoading() {
  return (
    <div className="px-container-margin-mobile safe-pt safe-pb mx-auto w-full max-w-2xl md:px-8 md:py-8">
      <div className="py-4">
        <div className="skeleton h-7 w-40 rounded" />
        <div className="skeleton mt-2 h-4 w-56 rounded" />
      </div>
      <div className="mb-6 flex flex-col gap-unit">
        <BalanceCardSkeleton />
        <div className="grid grid-cols-2 gap-unit">
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
        </div>
      </div>
      <ListSkeleton rows={3} />
    </div>
  );
}
