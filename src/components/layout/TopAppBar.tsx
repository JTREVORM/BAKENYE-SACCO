import Link from 'next/link';
import Image from 'next/image';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';

/**
 * The mobile top app bar from the Stitch member screens: 56px tall, the BND
 * crest and wordmark on the left, notifications on the right.
 *
 * Stitch pointed the logo at a remote Google-hosted URL that will eventually
 * expire; the same asset now lives in `public/brand/bnd-logo.png`, so it keeps
 * working offline and is served with proper cache headers.
 */
export function TopAppBar({
  title,
  backHref,
  unreadCount = 0,
  action,
}: {
  /** When set, replaces the wordmark — used on detail and wizard screens. */
  title?: string;
  backHref?: string;
  unreadCount?: number;
  action?: React.ReactNode;
}) {
  return (
    <header
      data-app-header
      className={clsx(
        'bg-surface border-outline-variant pt-safe fixed left-0 top-0 z-50 w-full border-b',
        'px-container-margin-mobile flex items-center justify-between',
        'h-touch-target-primary md:hidden',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Go back"
            className="text-primary hover:bg-surface-container-low -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          >
            <Icon name="arrow_back" />
          </Link>
        ) : (
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={32}
            height={32}
            priority
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        )}
        <h1 className="text-headline-lg-mobile font-headline-lg-mobile text-primary truncate font-bold">
          {title ?? 'BND-SACCO'}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {action}
        <Link
          href="/notifications"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          className="text-primary hover:bg-surface-container-low relative flex h-10 w-10 items-center justify-center rounded-full transition-colors"
        >
          <Icon name="notifications" />
          {unreadCount > 0 ? (
            <span className="bg-error text-on-error ring-surface absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ring-2">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
