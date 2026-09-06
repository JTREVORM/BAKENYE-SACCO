import Image from 'next/image';

/**
 * Route-level loading state.
 *
 * Deliberately minimal: the individual pages provide skeletons that match their
 * own layout, so this only ever shows during a full route transition.
 */
export default function Loading() {
  return (
    <div className="bg-background flex min-h-[100dvh] flex-col items-center justify-center gap-4">
      <Image
        src="/brand/bnd-logo.png"
        alt=""
        width={64}
        height={64}
        priority
        className="h-16 w-16 animate-skeleton-pulse object-contain"
      />
      <p className="text-body-md font-body-md text-on-surface-variant" role="status">
        Loading…
      </p>
    </div>
  );
}
