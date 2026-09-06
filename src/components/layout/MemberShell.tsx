import { TopAppBar } from './TopAppBar';
import { BottomNav } from './BottomNav';
import { MemberDesktopRail } from './MemberDesktopRail';
import { MEMBER_NAV } from '@/lib/rbac';
import { clsx } from '@/lib/clsx';

/**
 * The member application chrome.
 *
 * The Stitch member screens were exported with `md:hidden` on `<body>` — they
 * were mobile-only previews. Members do open the app on a laptop at the branch
 * office, so instead of hiding everything above 768px we keep the exact mobile
 * composition and give the wider viewport a left rail plus a centred column.
 * Nothing about the mobile rendering changes.
 */
export function MemberShell({
  children,
  title,
  backHref,
  unreadCount = 0,
  headerAction,
  /** Set on screens that supply their own full-bleed background (receipts). */
  bare = false,
}: {
  children: React.ReactNode;
  title?: string;
  backHref?: string;
  unreadCount?: number;
  headerAction?: React.ReactNode;
  bare?: boolean;
}) {
  return (
    <div className="bg-background text-on-background flex h-[100dvh] overflow-hidden">
      <MemberDesktopRail unreadCount={unreadCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopAppBar
          title={title}
          backHref={backHref}
          unreadCount={unreadCount}
          action={headerAction}
        />

        <main
          className={clsx(
            'safe-pt safe-pb flex-1 overflow-y-auto',
            // Desktop has the rail instead of the fixed bars, so it needs
            // neither the top offset nor the bottom-bar clearance.
            // Utilities layer after components, so these override safe-pt/safe-pb.
            'md:pb-8 md:pt-8',
            !bare && 'px-container-margin-mobile md:px-8',
          )}
        >
          <div className={clsx(!bare && 'mx-auto w-full max-w-2xl')}>{children}</div>
        </main>

        <BottomNav items={MEMBER_NAV} />
      </div>
    </div>
  );
}
