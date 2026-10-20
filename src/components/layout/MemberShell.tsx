import { TopAppBar } from './TopAppBar';
import { MemberDesktopRail } from './MemberDesktopRail';
import { ScrollArea } from '@/components/ui/scroll';
import { clsx } from '@/lib/clsx';

/**
 * The member application chrome.
 *
 * The Stitch member screens were exported with `md:hidden` on `<body>` — they
 * were mobile-only previews. Members do open the app on a laptop at the branch
 * office, so instead of hiding everything above 768px we keep the mobile
 * composition and give the wider viewport a left rail plus a centred column.
 *
 * Mobile navigation is the drawer behind the menu button in `TopAppBar`. There
 * is no bottom tab bar: it took 80px off the bottom of every screen, and the
 * drawer reaches every destination rather than four of them.
 */
export function MemberShell({
  children,
  title,
  backHref,
  unreadCount = 0,
  headerAction,
  /** Set on screens that supply their own full-bleed background (receipts). */
  bare = false,
  dashboard = false,
  desktopHeader,
}: {
  children: React.ReactNode;
  title?: string;
  backHref?: string;
  unreadCount?: number;
  headerAction?: React.ReactNode;
  bare?: boolean;
  /** The home dashboard has a wider composition; other portal pages retain theirs. */
  dashboard?: boolean;
  desktopHeader?: React.ReactNode;
}) {
  return (
    <div data-member-shell={dashboard || undefined} className="bg-background text-on-background flex h-[100dvh] overflow-hidden">
      <MemberDesktopRail unreadCount={unreadCount} homeActive={dashboard} />

      <div className="flex min-w-0 flex-1 flex-col">
        {desktopHeader ? <div className="hidden md:block">{desktopHeader}</div> : null}
        <TopAppBar
          title={title}
          backHref={backHref}
          unreadCount={unreadCount}
          action={headerAction}
          homeActive={dashboard}
        />

        {/* `<main>` stays the landmark; the scrolling itself happens one level
            in, so the up/down pager can be anchored to the corner of the
            viewport rather than travelling with the content. */}
        <main className="flex min-h-0 flex-1 flex-col">
          <ScrollArea
            stableGutter
            wrapperClassName="flex-1"
            className={clsx(
              'safe-pt safe-pb',
              // Desktop has the rail instead of the fixed top bar, so it needs no
              // top offset. Utilities layer after components, so these override
              // safe-pt/safe-pb.
              dashboard ? 'md:py-6' : 'md:pb-8 md:pt-8',
              !bare && 'px-container-margin-mobile md:px-8',
            )}
          >
            <div className={clsx(!bare && 'mx-auto w-full', !bare && (dashboard ? 'max-w-[1440px]' : 'max-w-2xl'))}>{children}</div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}
