import Link from 'next/link';
import Image from 'next/image';
import { clsx } from '@/lib/clsx';
import { Icon } from '@/components/ui/primitives';
import { MemberDrawer } from './MemberDrawer';

/**
 * The mobile top app bar: the menu button and the BND crest on the left,
 * notifications on the right.
 *
 * The menu button is the member app's only mobile navigation — the bottom tab
 * bar is gone — so it is on every screen, in the same place, including the
 * detail screens that also carry a back arrow.
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
        'fixed left-0 top-0 z-50 w-full bg-surface/95 pt-safe shadow-neu-sm backdrop-blur',
        'flex items-center justify-between px-container-margin-mobile',
        'h-touch-target-primary md:hidden',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <MemberDrawer unreadCount={unreadCount} />

        {backHref ? (
          <Link
            href={backHref}
            aria-label="Go back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-shadow hover:bg-surface hover:shadow-neu-sm active:shadow-neu-pressed"
          >
            <Icon name="arrow_back" size={21} />
          </Link>
        ) : (
          <Image
            src="/brand/bnd-logo.png"
            alt=""
            width={32}
            height={32}
            priority
            className="ml-1 h-8 w-8 shrink-0 object-contain"
          />
        )}
        <h1 className="ml-1 truncate text-title-md text-on-surface">{title ?? 'BUD-SACCO'}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {action}
        <Link
          href="/notifications"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          className="relative flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-shadow hover:bg-surface hover:shadow-neu-sm active:shadow-neu-pressed"
        >
          <Icon name="notifications" size={21} filled={false} />
          {unreadCount > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error ring-2 ring-surface">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
